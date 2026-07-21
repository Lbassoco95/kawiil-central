import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GoogleAccountRow {
  id: string;
  email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  calendar_enabled: boolean;
  status: string;
}

/** Refresca el access_token si expiró; devuelve un token válido o null. */
async function ensureAccessToken(
  supabaseAdmin: ReturnType<typeof createClient>,
  account: GoogleAccountRow,
): Promise<string | null> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - 60_000 > now) return account.access_token;
  if (!account.refresh_token) return account.access_token ?? null;

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!.trim();
  const res = await fetch("https://oauth2.googleapis.com/token", {
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
    token_expires_at: newExpiry,
    status: "connected",
    last_error: null,
  }).eq("id", account.id);
  return data.access_token;
}

/** Normaliza un evento de Google Calendar al formato tipo Microsoft Graph que usa el frontend. */
function normalizeEvent(ev: Record<string, any>, namespacedCalendarId: string, calName: string) {
  const isAllDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  return {
    id: `google:${ev.id}`,
    subject: ev.summary ?? "(sin título)",
    start: { dateTime: ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00` : undefined), date: ev.start?.date },
    end: { dateTime: ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00` : undefined), date: ev.end?.date },
    location: ev.location ? { displayName: ev.location } : null,
    body: { content: ev.description ?? "", contentType: "text" },
    isAllDay,
    onlineMeetingUrl: ev.hangoutLink ?? null,
    categories: [],
    calendarId: namespacedCalendarId,
    calendarName: calName,
    _source: "google",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { action, params } = await req.json();
    const accountId = params?.accountId as string | undefined;

    const { data: accountsRaw } = await supabaseAdmin
      .from("linked_accounts")
      .select("id, email, access_token, refresh_token, token_expires_at, calendar_enabled, status")
      .eq("user_id", user.id)
      .eq("provider", "google");
    const accounts = (accountsRaw ?? []) as GoogleAccountRow[];

    if (accounts.length === 0) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (action === "calendars") {
      const all: any[] = [];
      for (const acc of accounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const json = await res.json();
        for (const item of json.items ?? []) {
          all.push({
            id: `google:${acc.id}:${item.id}`,
            name: acc.email ? `${item.summary} · ${acc.email}` : item.summary,
            hexColor: item.backgroundColor,
            isDefaultCalendar: item.primary === true,
            canEdit: item.accessRole === "owner" || item.accessRole === "writer",
            _source: "google",
            _accountId: acc.id,
          });
        }
      }
      return new Response(JSON.stringify({ value: all }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "calendar-events") {
      const start = params?.start || new Date().toISOString();
      const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const merged: any[] = [];

      for (const acc of accounts) {
        if (!acc.calendar_enabled) continue;
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;

        // Calendarios de esta cuenta
        const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!calRes.ok) continue;
        const calJson = await calRes.json();
        const calendars = (calJson.items ?? []).filter((c: any) => c.selected !== false);

        for (const cal of calendars) {
          const qs = new URLSearchParams({
            timeMin: start,
            timeMax: end,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "250",
          });
          const evRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${qs.toString()}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!evRes.ok) continue;
          const evJson = await evRes.json();
          const nsCalId = `google:${acc.id}:${cal.id}`;
          for (const ev of evJson.items ?? []) {
            if (ev.status === "cancelled") continue;
            merged.push(normalizeEvent(ev, nsCalId, cal.summary));
          }
        }
      }

      merged.sort((a, b) => String(a.start?.dateTime ?? "").localeCompare(String(b.start?.dateTime ?? "")));
      return new Response(JSON.stringify({ value: merged }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create-event") {
      // Crea un evento en el calendario principal de la primera cuenta Google conectada.
      // params: { summary, description?, location?, date? (all-day YYYY-MM-DD),
      //           startDateTime?, endDateTime? (timed, ISO) }
      const acc = accounts.find((a) => a.calendar_enabled) || accounts[0];
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) {
        return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const tz = "America/Mexico_City";
      let start: Record<string, string>;
      let end: Record<string, string>;
      if (params?.startDateTime) {
        start = { dateTime: params.startDateTime, timeZone: tz };
        end = { dateTime: params.endDateTime || params.startDateTime, timeZone: tz };
      } else {
        // Evento de día completo. En Google, end.date es exclusivo (+1 día).
        const d = String(params?.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const next = new Date(`${d}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        start = { date: d };
        end = { date: next.toISOString().slice(0, 10) };
      }

      const body: Record<string, unknown> = {
        summary: params?.summary || "(sin título)",
        start,
        end,
      };
      if (params?.description) body.description = params.description;
      if (params?.location) body.location = params.location;

      const res = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: json?.error?.message || "create_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: json.id, htmlLink: json.htmlLink }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── GMAIL EMAIL ACTIONS ───────────────────────────────────────────────

    function decodeBase64Url(data: string, charset = "utf-8"): string {
      try {
        // atob da un string binario (1 char = 1 byte); hay que decodificar los bytes con el
        // charset real o los acentos salen como mojibake ("atenciÃ³n" en vez de "atención").
        const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // UTF-8 PRIMERO con validación estricta: muchos correos (gobierno/banca) declaran
        // un charset legacy (iso-8859-1) pero su contenido real ES UTF-8. Respetar el charset
        // declarado los rompería. Si el contenido es UTF-8 válido, ganó UTF-8; si no, usamos
        // el charset declarado (o windows-1252 como respaldo latino).
        try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { /* no es UTF-8 válido → legacy */ }
        const legacy = charset && charset !== "utf-8" ? charset : "windows-1252";
        try { return new TextDecoder(legacy).decode(bytes); }
        catch { return new TextDecoder("utf-8").decode(bytes); }
      } catch { return ""; }
    }

    /** Charset declarado en el Content-Type de la parte MIME (default utf-8). */
    function partCharset(payload: any): string {
      const ct = (payload?.headers || []).find((h: any) => String(h.name).toLowerCase() === "content-type")?.value || "";
      const m = String(ct).match(/charset="?([^";\s]+)"?/i);
      return m ? m[1].toLowerCase() : "utf-8";
    }

    function extractGmailBody(payload: any): { html?: string; text?: string } {
      if (!payload) return {};
      if (payload.mimeType === "text/html" && payload.body?.data) return { html: decodeBase64Url(payload.body.data, partCharset(payload)) };
      if (payload.mimeType === "text/plain" && payload.body?.data) return { text: decodeBase64Url(payload.body.data, partCharset(payload)) };
      if (payload.parts) {
        let html: string | undefined, text: string | undefined;
        for (const p of payload.parts) { const r = extractGmailBody(p); if (r.html) html = r.html; if (r.text && !text) text = r.text; }
        return { html, text };
      }
      return {};
    }

    function parseGmailAddr(raw: string): { name: string; address: string } {
      const m = raw.match(/^(.+?)\s*<([^>]+)>$/);
      if (m) return { name: m[1].trim().replace(/^"(.*)"$/, "$1"), address: m[2].trim() };
      return { name: "", address: raw.trim() };
    }

    /** Decodifica encoded-words RFC 2047 en headers: "=?UTF-8?B?...?=" / "=?UTF-8?Q?...?=". */
    function decodeRfc2047(value: string): string {
      if (!value.includes("=?")) return value;
      // Palabras codificadas adyacentes se unen sin el espacio intermedio (RFC 2047 §6.2).
      const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
      return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, text) => {
        try {
          let bin: string;
          if (String(enc).toUpperCase() === "B") {
            bin = atob(text);
          } else {
            bin = text
              .replace(/_/g, " ")
              .replace(/=([0-9A-Fa-f]{2})/g, (_s: string, h: string) => String.fromCharCode(parseInt(h, 16)));
          }
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
          return new TextDecoder(String(charset).toLowerCase()).decode(bytes);
        } catch { return text; }
      });
    }

    function normalizeGmailMsg(msg: any, accId: string, accEmail: string) {
      const hdrs: Array<{ name: string; value: string }> = msg.payload?.headers || [];
      const hdr = (n: string) =>
        decodeRfc2047(hdrs.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "");
      const from = parseGmailAddr(hdr("from"));
      const dateStr = hdr("date");
      const receivedDateTime = dateStr ? (() => { try { return new Date(dateStr).toISOString(); } catch { return new Date().toISOString(); } })() : new Date().toISOString();
      return {
        id: `gmail:${accId}:${msg.id}`,
        subject: hdr("subject") || "(sin asunto)",
        bodyPreview: msg.snippet || "",
        from: { emailAddress: { name: from.name, address: from.address } },
        toRecipients: (hdr("to") || "").split(",").filter(Boolean).map((t: string) => {
          const p = parseGmailAddr(t.trim()); return { emailAddress: { name: p.name, address: p.address } };
        }),
        receivedDateTime,
        isRead: !(msg.labelIds?.includes("UNREAD") ?? false),
        hasAttachments: !!(msg.payload?.parts?.some((p: any) => p.filename && p.filename.length > 0)),
        importance: "normal",
        conversationId: `gmail:${accId}:${msg.threadId}`,
        _source: "gmail",
        _accountId: accId,
        _provider: "google",
        _accountEmail: accEmail,
      };
    }

    if (action === "gmail-emails") {
      const targetAccounts = accountId ? accounts.filter(a => a.id === accountId) : accounts;
      if (accountId && targetAccounts.length === 0) {
        return new Response(
          JSON.stringify({ error: "Esta cuenta no está disponible para correo. Reconéctala para autorizar el acceso.", code: "REAUTH_REQUIRED" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const labelId = params?.labelId || "INBOX";
      const maxResults = Math.min(Number(params?.maxResults) || 25, 100);
      const filterUnread = params?.filterUnread === true;
      const q = filterUnread ? "is:unread" : "";
      const allEmails: unknown[] = [];
      let nextPageToken: string | undefined;
      for (const acc of targetAccounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) {
          // Cuenta pedida explícitamente sin token válido → el usuario debe reconectar.
          if (accountId) {
            return new Response(
              JSON.stringify({ error: "Reconecta esta cuenta de Google para dar acceso al correo.", code: "REAUTH_REQUIRED" }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          continue;
        }
        const listQs = new URLSearchParams({ labelIds: labelId, maxResults: String(maxResults) });
        if (params?.pageToken) listQs.set("pageToken", params.pageToken);
        if (q) listQs.set("q", q);
        const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${listQs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!listRes.ok) {
          if (accountId) {
            const body = await listRes.text();
            // 403 con accessNotConfigured = la Gmail API no está habilitada en el proyecto
            // de Google Cloud; reconectar la cuenta NO lo arregla.
            if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project/i.test(body)) {
              return new Response(
                JSON.stringify({ error: "La API de Gmail no está habilitada en el proyecto de Google Cloud de Kawiil. Actívala en console.cloud.google.com → APIs y servicios → Biblioteca → Gmail API → Habilitar. Reconectar la cuenta no resuelve esto." }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            // 401/403 restantes = el token no incluye los scopes de Gmail.
            if (listRes.status === 401 || listRes.status === 403) {
              return new Response(
                JSON.stringify({ error: "Esta cuenta se conectó solo para calendario. Reconéctala para autorizar el correo.", code: "REAUTH_REQUIRED" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            // Cualquier otro fallo: exponer el motivo real, nunca lista vacía.
            return new Response(
              JSON.stringify({ error: `Gmail API [${listRes.status}]: ${body.slice(0, 300)}` }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          continue;
        }
        const listJson = await listRes.json();
        const msgIds: string[] = (listJson.messages ?? []).map((m: any) => m.id);
        if (listJson.nextPageToken && accountId) nextPageToken = listJson.nextPageToken;
        const metaFetches = msgIds.map((id: string) =>
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.ok ? r.json() : null)
        );
        const metas = await Promise.all(metaFetches);
        for (const meta of metas) { if (meta) allEmails.push(normalizeGmailMsg(meta, acc.id, acc.email || "")); }
      }
      (allEmails as any[]).sort((a, b) => String(b.receivedDateTime ?? "").localeCompare(String(a.receivedDateTime ?? "")));
      return new Response(JSON.stringify({ value: allEmails, nextPageToken }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-detail") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const msg = await res.json();
      const hdrs: Array<{ name: string; value: string }> = msg.payload?.headers || [];
      const hdr = (n: string) =>
        decodeRfc2047(hdrs.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "");
      const { html, text } = extractGmailBody(msg.payload);
      const normalized = normalizeGmailMsg(msg, acc.id, acc.email || "");
      return new Response(JSON.stringify({
        ...normalized,
        body: { contentType: html ? "html" : "text", content: html || (text ? text.replace(/\n/g, "<br>") : "") },
        internetMessageId: hdr("message-id"),
        references: hdr("references"),
        inReplyTo: hdr("in-reply-to"),
        ccRecipients: (hdr("cc") || "").split(",").filter(Boolean).map((t: string) => {
          const p = parseGmailAddr(t.trim()); return { emailAddress: { name: p.name, address: p.address } };
        }),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Lista de adjuntos de un correo de Gmail (recorre las partes MIME con filename).
    if (action === "gmail-attachments") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const msg = await res.json();
      const out: any[] = [];
      const walk = (p: any) => {
        if (!p) return;
        if (p.filename && p.filename.length > 0 && p.body?.attachmentId) {
          out.push({ id: p.body.attachmentId, name: p.filename, contentType: p.mimeType || "application/octet-stream", size: p.body.size ?? 0, isInline: false });
        }
        (p.parts || []).forEach(walk);
      };
      walk(msg.payload);
      return new Response(JSON.stringify({ value: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Bytes de un adjunto de Gmail (base64) para descargar/visualizar.
    if (action === "gmail-attachment-content") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      const attId = String(params?.attachmentId || "");
      if (!rawId || !attId) return new Response(JSON.stringify({ error: "emailId y attachmentId requeridos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}/attachments/${attId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const json = await res.json();
      // Gmail devuelve base64url; convertir a base64 estándar para el frontend.
      const b64 = String(json.data || "").replace(/-/g, "+").replace(/_/g, "/");
      return new Response(JSON.stringify({
        contentType: String(params?.contentType || "application/octet-stream"),
        name: String(params?.name || "adjunto"),
        size: json.size,
        contentBytes: b64,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-labels") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const json = await res.json();
      const SYSTEM_LABELS = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED"]);
      const labels = (json.labels ?? [])
        .filter((l: any) => l.type !== "system" || SYSTEM_LABELS.has(l.id))
        .map((l: any) => ({ id: `gmail:${acc.id}:${l.id}`, name: l.name, type: l.type, _accountId: acc.id, _rawId: l.id }));
      return new Response(JSON.stringify({ value: labels, _accountId: acc.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-inbox-meta") {
      const targetAccounts = accountId ? accounts.filter(a => a.id === accountId) : accounts;
      const metaList: unknown[] = [];
      for (const acc of targetAccounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        const json = await res.json();
        metaList.push({ accountId: acc.id, email: acc.email, unreadItemCount: json.messagesUnread ?? 0 });
      }
      return new Response(JSON.stringify({ accounts: metaList }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-mark-read") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}/modify`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-archive") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}/modify`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-send") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const toList: string[] = params?.to || [];
      const ccList: string[] = params?.cc || [];
      const subjectB64 = btoa(unescape(encodeURIComponent(params?.subject || "(sin asunto)")));
      const bodyB64 = btoa(unescape(encodeURIComponent(params?.bodyHtml || "")));
      const lines = [
        `From: ${acc.email}`,
        `To: ${toList.join(", ")}`,
        ...(ccList.length ? [`Cc: ${ccList.join(", ")}`] : []),
        `Subject: =?UTF-8?B?${subjectB64}?=`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        bodyB64,
      ];
      const raw = btoa(lines.join("\r\n")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: (errJson as any)?.error?.message || "send_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in google-api:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
