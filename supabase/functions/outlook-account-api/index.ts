import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MsAccountRow {
  id: string;
  email: string | null;
  display_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  calendar_enabled: boolean;
  mail_enabled: boolean;
  status: string;
}

async function ensureAccessToken(
  supabaseAdmin: ReturnType<typeof createClient>,
  account: MsAccountRow,
): Promise<string | null> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - 60_000 > now) return account.access_token;
  if (!account.refresh_token) return account.access_token ?? null;

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const tenantId = Deno.env.get("MICROSOFT_LINKED_TENANT_ID")?.trim() || "common";
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    await supabaseAdmin.from("linked_accounts").update({ status: "error", last_error: "refresh_failed" }).eq("id", account.id);
    return null;
  }
  const newExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await supabaseAdmin.from("linked_accounts").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? account.refresh_token,
    token_expires_at: newExpiry,
    status: "connected",
    last_error: null,
  }).eq("id", account.id);
  return data.access_token;
}

async function graphFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Prefer': 'IdType="ImmutableId"',
      ...(init?.headers as Record<string, string> ?? {}),
    },
  });
}

const PREFER_TZ = { Prefer: 'outlook.timezone="America/Mexico_City"' };
// Sin `sensitivity`: Graph la rechaza de forma intermitente en listados (RequestBroker--ParseUri).
const MAIL_SELECT = "$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,createdDateTime,isRead,hasAttachments,importance,conversationId";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) return jsonResp({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { action, params } = await req.json();

    const { data: accountsRaw } = await supabaseAdmin
      .from("linked_accounts")
      .select("id, email, display_name, access_token, refresh_token, token_expires_at, calendar_enabled, mail_enabled, status")
      .eq("user_id", user.id)
      .eq("provider", "microsoft");
    const accounts = (accountsRaw ?? []) as MsAccountRow[];
    if (accounts.length === 0) return jsonResp({ value: [] });

    const getAccount = (accountId?: string): MsAccountRow | null => {
      if (accountId) return accounts.find(a => a.id === accountId) ?? null;
      return accounts.find(a => a.mail_enabled) ?? accounts[0] ?? null;
    };

    // ─── CALENDAR ACTIONS ────────────────────────────────────────────────────
    if (action === "calendars") {
      const all: unknown[] = [];
      for (const acc of accounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const res = await graphFetch(token, "/me/calendars?$select=id,name,hexColor,color,isDefaultCalendar,canEdit&$top=100");
        if (!res.ok) continue;
        const json = await res.json();
        for (const item of json.value ?? []) {
          all.push({
            id: `outlook:${acc.id}:${item.id}`,
            name: acc.email ? `${item.name} · ${acc.email}` : item.name,
            hexColor: item.hexColor && item.hexColor !== "auto" ? item.hexColor : undefined,
            isDefaultCalendar: item.isDefaultCalendar === true,
            canEdit: item.canEdit === true,
            _source: "outlook",
            _accountId: acc.id,
          });
        }
      }
      return jsonResp({ value: all });
    }

    if (action === "calendar-events") {
      const start = params?.start || new Date().toISOString();
      const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const qs = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=200`;
      const merged: unknown[] = [];
      for (const acc of accounts) {
        if (!acc.calendar_enabled) continue;
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const calRes = await graphFetch(token, "/me/calendars?$select=id,name&$top=100");
        const calJson = calRes.ok ? await calRes.json() : { value: [] };
        for (const cal of calJson.value ?? []) {
          const evRes = await graphFetch(token, `/me/calendars/${encodeURIComponent(cal.id)}/calendarview?${qs}`, { headers: PREFER_TZ });
          if (!evRes.ok) continue;
          const evJson = await evRes.json();
          const nsCalId = `outlook:${acc.id}:${cal.id}`;
          for (const ev of evJson.value ?? []) {
            merged.push({ ...ev, id: `outlook:${ev.id}`, calendarId: nsCalId, calendarName: cal.name, _source: "outlook" });
          }
        }
      }
      (merged as any[]).sort((a, b) => String(a.start?.dateTime ?? "").localeCompare(String(b.start?.dateTime ?? "")));
      return jsonResp({ value: merged });
    }

    if (action === "create-event") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const tz = "America/Mexico_City";
      const body: Record<string, unknown> = { subject: params?.summary || "(sin título)" };
      if (params?.startDateTime) {
        body.start = { dateTime: params.startDateTime, timeZone: tz };
        body.end = { dateTime: params.endDateTime || params.startDateTime, timeZone: tz };
      } else {
        const d = String(params?.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        body.isAllDay = true;
        body.start = { dateTime: `${d}T00:00:00`, timeZone: tz };
        const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        body.end = { dateTime: `${next.toISOString().slice(0, 10)}T00:00:00`, timeZone: tz };
      }
      if (params?.description) body.body = { contentType: "text", content: params.description };
      if (params?.location) body.location = { displayName: params.location };
      const res = await graphFetch(token, "/me/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) return jsonResp({ error: json?.error?.message || "create_failed" }, 400);
      return jsonResp({ id: json.id, htmlLink: json.webLink });
    }

    if (action === "respond-event") {
      // RSVP en una cuenta Outlook vinculada. params: { accountId, eventId, response, comment?, sendResponse? }
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);

      const allowed: Record<string, string> = {
        accept: "accept",
        decline: "decline",
        tentative: "tentativelyAccept",
        tentativelyAccept: "tentativelyAccept",
      };
      const graphAction = allowed[String(params?.response || "").trim()];
      if (!graphAction) return jsonResp({ error: "invalid_response" }, 400);

      const rawEventId = String(params?.eventId || "").replace(/^outlook:/, "");
      if (!rawEventId) return jsonResp({ error: "missing_event" }, 400);

      const body: Record<string, unknown> = { sendResponse: params?.sendResponse !== false };
      if (typeof params?.comment === "string" && params.comment.trim()) body.comment = params.comment.trim();

      const res = await graphFetch(token, `/me/events/${encodeURIComponent(rawEventId)}/${graphAction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 202) {
        let msg = "respond_failed";
        try { const j = await res.json(); msg = j?.error?.message || msg; } catch { /* sin cuerpo */ }
        return jsonResp({ error: msg }, 400);
      }
      return jsonResp({ success: true });
    }

    if (action === "update-event") {
      // Edita un evento de una cuenta Outlook vinculada. params: { accountId, eventId, payload }
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const rawEventId = String(params?.eventId || "").replace(/^outlook:/, "");
      if (!rawEventId) return jsonResp({ error: "missing_event" }, 400);
      const payload = params?.payload && typeof params.payload === "object" ? params.payload : {};

      const res = await graphFetch(token, `/me/events/${encodeURIComponent(rawEventId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: 'outlook.timezone="America/Mexico_City"' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text)?.error?.message || msg; } catch { /* sin cuerpo JSON */ }
        return jsonResp({ error: msg }, 400);
      }
      return jsonResp(text ? JSON.parse(text) : { success: true });
    }

    if (action === "delete-event") {
      // Elimina un evento de una cuenta Outlook vinculada. params: { accountId, eventId }
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const rawEventId = String(params?.eventId || "").replace(/^outlook:/, "");
      if (!rawEventId) return jsonResp({ error: "missing_event" }, 400);
      const res = await graphFetch(token, `/me/events/${encodeURIComponent(rawEventId)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json())?.error?.message || msg; } catch { /* sin cuerpo */ }
        return jsonResp({ error: msg }, 400);
      }
      return jsonResp({ success: true });
    }

    // ─── EMAIL ACTIONS ───────────────────────────────────────────────────────

    if (action === "emails") {
      const accountId = params?.accountId as string | undefined;
      const targetAccounts = accountId
        ? accounts.filter(a => a.id === accountId && a.mail_enabled)
        : accounts.filter(a => a.mail_enabled);
      const folder = params?.folder || "inbox";
      const top = Math.min(Number(params?.top) || 25, 100);
      const filterUnread = params?.filterUnread === true;
      // Graph exige que la propiedad del $orderby aparezca PRIMERO en el $filter
      // (si no, responde 400 InefficientFilter).
      const filterParam = filterUnread
        ? "&$filter=receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false"
        : "";
      const listSelect = MAIL_SELECT;
      // Búsqueda: con $search Graph no admite $orderby/$filter y busca en todo el buzón.
      const rawSearch = typeof params?.search === "string"
        ? params.search.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/"/g, " ").replace(/\s+/g, " ").trim()
        : "";

      if (params?.nextLink && typeof params.nextLink === "string") {
        const link = params.nextLink as string;
        if (!link.startsWith("https://graph.microsoft.com/v1.0/")) return jsonResp({ error: "nextLink invalido" }, 400);
        const u = new URL(link);
        const path = u.pathname.slice("/v1.0".length) + u.search;
        const acc = getAccount(accountId);
        if (!acc) return jsonResp({ value: [] });
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) return jsonResp({ value: [] });
        const res = await graphFetch(token, path);
        const json = res.ok ? await res.json() : { value: [] };
        const emails = (json.value ?? []).map((e: any) => ({
          ...e,
          id: `outlook:${acc.id}:${e.id}`,
          _source: "outlook",
          _accountId: acc.id,
          _provider: "microsoft",
          _accountEmail: acc.email || "",
        }));
        return jsonResp({ value: emails, "@odata.nextLink": json["@odata.nextLink"] });
      }

      // Cuenta pedida explícitamente pero sin fila válida (no existe o mail deshabilitado).
      if (accountId && targetAccounts.length === 0) {
        return jsonResp({ error: "Esta cuenta no está disponible para correo. Reconéctala para autorizar el acceso.", code: "REAUTH_REQUIRED" });
      }

      const allEmails: unknown[] = [];
      let nextLink: string | undefined;
      for (const acc of targetAccounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) {
          if (accountId) {
            return jsonResp({ error: "Reconecta esta cuenta de Outlook para dar acceso al correo.", code: "REAUTH_REQUIRED" });
          }
          continue;
        }
        // Con búsqueda: $search en todo el buzón (sin $orderby/$filter, que Graph no permite combinar).
        // Espacio entre términos = AND implícito en KQL; si no hay coincidencias con varias palabras,
        // ampliamos con OR para no dejar sin resultados cuando un término (p. ej. el nombre) está
        // escrito distinto pero otro sí coincide (el asunto).
        const searchTerms = rawSearch.split(" ").filter(Boolean);
        const searchPath = (expr: string) =>
          `/me/messages?${listSelect}&$top=${top}&$search=${encodeURIComponent(`"${expr}"`)}`;
        const folderPath = `/me/mailFolders/${encodeURIComponent(folder)}/messages?${listSelect}&$top=${top}&$orderby=receivedDateTime desc&$count=true${filterParam}`;
        let res = await graphFetch(token, rawSearch ? searchPath(searchTerms.join(" ")) : folderPath);
        if (!res.ok) {
          // Con cuenta específica NUNCA tragarse el fallo: sin esto la UI muestra
          // "No hay mensajes" en lugar del motivo real.
          if (accountId) {
            // 401/403 = el token no incluye scopes de Mail (cuenta conectada solo para calendario).
            if (res.status === 401 || res.status === 403) {
              return jsonResp({ error: "Esta cuenta se conectó solo para calendario. Reconéctala para autorizar el correo.", code: "REAUTH_REQUIRED" });
            }
            const body = await res.text();
            return jsonResp({ error: `Microsoft Graph [${res.status}]: ${body.slice(0, 300)}` });
          }
          continue;
        }
        let json = await res.json();
        // Fallback OR cuando la búsqueda AND no encontró nada y hay varias palabras.
        if (rawSearch && searchTerms.length > 1 && (!Array.isArray(json.value) || json.value.length === 0)) {
          const orRes = await graphFetch(token, searchPath(searchTerms.join(" OR ")));
          if (orRes.ok) json = await orRes.json();
        }
        for (const e of json.value ?? []) {
          allEmails.push({
            ...e,
            id: `outlook:${acc.id}:${e.id}`,
            _source: "outlook",
            _accountId: acc.id,
            _provider: "microsoft",
            _accountEmail: acc.email || "",
          });
        }
        if (accountId && json["@odata.nextLink"]) nextLink = json["@odata.nextLink"];
      }
      (allEmails as any[]).sort((a, b) =>
        String(b.receivedDateTime ?? "").localeCompare(String(a.receivedDateTime ?? ""))
      );
      return jsonResp({ value: allEmails, "@odata.nextLink": nextLink, "@odata.count": allEmails.length });
    }

    if (action === "email-detail") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const rawId = String(params?.emailId || "").replace(/^outlook:[^:]+:/, "");
      if (!rawId) return jsonResp({ error: "emailId requerido" }, 400);
      // Sin $select: Graph rechaza intermitentemente `sensitivity` en el $select
      // (RequestBroker--ParseUri), lo que dejaba la vista grande en blanco. El GET completo
      // devuelve body y todos los campos por defecto sin ese riesgo.
      const res = await graphFetch(token, `/me/messages/${encodeURIComponent(rawId)}`);
      if (!res.ok) {
        const body = await res.text();
        return jsonResp({ error: `Graph [${res.status}]: ${body.slice(0, 200)}` }, res.status === 404 ? 404 : 400);
      }
      const json = await res.json();
      return jsonResp({
        ...json,
        id: `outlook:${acc.id}:${json.id}`,
        _source: "outlook",
        _accountId: acc.id,
        _provider: "microsoft",
        _accountEmail: acc.email || "",
      });
    }

    // Lista de adjuntos de un correo vinculado (metadatos, sin bytes).
    if (action === "email-attachments") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ value: [] });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ value: [] });
      const rawId = String(params?.emailId || "").replace(/^outlook:[^:]+:/, "");
      if (!rawId) return jsonResp({ value: [] });
      const res = await graphFetch(token,
        `/me/messages/${encodeURIComponent(rawId)}/attachments?$select=id,name,contentType,size,isInline&$top=100`
      );
      if (!res.ok) return jsonResp({ value: [] });
      const json = await res.json();
      return jsonResp({ value: json.value ?? [] });
    }

    // Bytes de un adjunto (base64) para descargar/visualizar.
    if (action === "attachment-content") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const rawId = String(params?.emailId || "").replace(/^outlook:[^:]+:/, "");
      const attId = String(params?.attachmentId || "");
      if (!rawId || !attId) return jsonResp({ error: "emailId y attachmentId requeridos" }, 400);
      const res = await graphFetch(token,
        `/me/messages/${encodeURIComponent(rawId)}/attachments/${encodeURIComponent(attId)}`
      );
      if (!res.ok) return jsonResp({ error: "not_found" }, 404);
      const json = await res.json();
      // fileAttachment trae contentBytes (base64). Los itemAttachment/reference no se soportan aquí.
      return jsonResp({
        name: json.name,
        contentType: json.contentType || "application/octet-stream",
        size: json.size,
        contentBytes: json.contentBytes || "",
      });
    }

    if (action === "mail-folders") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ value: [] });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ value: [] });
      const res = await graphFetch(token,
        "/me/mailFolders?$select=id,displayName,wellKnownFolderName,unreadItemCount,totalItemCount&$top=100"
      );
      if (!res.ok) return jsonResp({ value: [] });
      const json = await res.json();
      const folders = (json.value ?? []).map((f: any) => ({
        ...f,
        id: `outlook:${acc.id}:${f.id}`,
        _accountId: acc.id,
        _rawId: f.id,
      }));
      return jsonResp({ folders, _accountId: acc.id });
    }

    if (action === "inbox-meta") {
      const targetAccounts = params?.accountId
        ? accounts.filter(a => a.id === params.accountId && a.mail_enabled)
        : accounts.filter(a => a.mail_enabled);
      const metaList: unknown[] = [];
      for (const acc of targetAccounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const res = await graphFetch(token, "/me/mailFolders/inbox?$select=id,unreadItemCount,totalItemCount");
        if (!res.ok) continue;
        const json = await res.json();
        metaList.push({ accountId: acc.id, email: acc.email, unreadItemCount: json.unreadItemCount ?? 0 });
      }
      return jsonResp({ accounts: metaList });
    }

    if (action === "send-email") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const makeRecipients = (addrs: string[]) => addrs.map(a => ({ emailAddress: { address: a } }));
      const message: Record<string, unknown> = {
        subject: params?.subject || "(sin asunto)",
        body: { contentType: "HTML", content: params?.bodyHtml || "" },
        toRecipients: makeRecipients(params?.to || []),
      };
      if (params?.cc?.length) message.ccRecipients = makeRecipients(params.cc);
      if (params?.bcc?.length) message.bccRecipients = makeRecipients(params.bcc);
      const res = await graphFetch(token, "/me/sendMail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return jsonResp({ error: (errJson as any)?.error?.message || "send_failed" }, 400);
      }
      return jsonResp({ success: true });
    }

    if (action === "mark-read") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const rawId = String(params?.emailId || "").replace(/^outlook:[^:]+:/, "");
      await graphFetch(token, `/me/messages/${encodeURIComponent(rawId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      });
      return jsonResp({ success: true });
    }

    if (action === "mark-unread") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const rawId = String(params?.emailId || "").replace(/^outlook:[^:]+:/, "");
      await graphFetch(token, `/me/messages/${encodeURIComponent(rawId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: false }),
      });
      return jsonResp({ success: true });
    }

    if (action === "archive-email") {
      const acc = getAccount(params?.accountId);
      if (!acc) return jsonResp({ error: "no_account" }, 400);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return jsonResp({ error: "no_valid_token" }, 400);
      const rawId = String(params?.emailId || "").replace(/^outlook:[^:]+:/, "");
      await graphFetch(token, `/me/messages/${encodeURIComponent(rawId)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationId: "archive" }),
      });
      return jsonResp({ success: true });
    }

    return jsonResp({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("Error in outlook-account-api:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
