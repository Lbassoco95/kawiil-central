import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Base64 para cuerpos binarios grandes (Graph suele omitir contentBytes en JSON y usar /$value). */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Igual que en email-detail: evita doble codificación (%252F) y alinea rutas con /me/messages/{id} sin encodeURIComponent. */
function normalizeGraphMessageOrAttachmentId(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch {
      break;
    }
  }
  return s;
}

const GRAPH_MAIL_PREFER_IMMUTABLE = { Prefer: 'IdType="ImmutableId"' };
/** Graph exige ConsistencyLevel eventual en búsquedas ($search) sobre mensajes. */
const GRAPH_MAIL_SEARCH_HEADERS = {
  ...GRAPH_MAIL_PREFER_IMMUTABLE,
  ConsistencyLevel: "eventual",
};

const GRAPH_MAX_RETRIES = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function graphRetryDelayMs(headers: Headers, attempt: number): number {
  const ra = headers.get("Retry-After");
  if (ra) {
    const sec = parseInt(ra, 10);
    if (!Number.isNaN(sec) && sec >= 0) {
      return Math.min(Math.max(sec * 1000, 500), 120_000);
    }
    const when = Date.parse(ra);
    if (!Number.isNaN(when)) {
      return Math.min(Math.max(when - Date.now(), 500), 120_000);
    }
  }
  const exp = Math.min(1_500 * Math.pow(2, attempt - 1), 45_000);
  const jitter = Math.floor(Math.random() * 400);
  return exp + jitter;
}

/** Extrae email/nombre de un recipient Graph (from / toRecipients / ccRecipients). */
function graphRecipientEntry(
  raw: unknown,
): { email: string; displayName: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const ea = (raw as { emailAddress?: { address?: string; name?: string } }).emailAddress;
  if (!ea?.address || typeof ea.address !== "string") return null;
  const email = ea.address.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const name = typeof ea.name === "string" ? ea.name.trim() : "";
  const displayName = name || email;
  return { email, displayName };
}

function collectRecipientsFromMessage(
  msg: Record<string, unknown>,
  into: Map<string, { email: string; displayName: string }>,
): void {
  const push = (e: { email: string; displayName: string }) => {
    const prev = into.get(e.email);
    if (!prev) {
      into.set(e.email, e);
      return;
    }
    const prevBare = !prev.displayName || prev.displayName === prev.email;
    const nextBare = !e.displayName || e.displayName === e.email;
    if (prevBare && !nextBare) into.set(e.email, e);
    else if (!prevBare && nextBare) return;
    else if ((e.displayName?.length ?? 0) > (prev.displayName?.length ?? 0)) into.set(e.email, e);
  };
  const from = graphRecipientEntry(msg.from);
  if (from) push(from);
  const lists = [msg.toRecipients, msg.ccRecipients, msg.bccRecipients];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const e = graphRecipientEntry(r);
      if (e) push(e);
    }
  }
}

function isGraphRetryable(status: number, errorBody: string): boolean {
  if (status === 429 || status === 503 || status === 504) return true;
  const lower = errorBody.toLowerCase();
  return (
    lower.includes("applicationthrottled") ||
    lower.includes("mailboxconcurrency") ||
    lower.includes("toomanyrequests") ||
    lower.includes('"code":"applicationthrottled"') ||
    lower.includes('"code":"throttled"')
  );
}

/**
 * Petición a Microsoft Graph con reintentos ante 429 (p. ej. MailboxConcurrency / ApplicationThrottled) y 503.
 */
async function graphMailFetchWithRetry(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const pathPart = path.startsWith("/") ? path : `/${path}`;
  const url = `${GRAPH_BASE}${pathPart}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= GRAPH_MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers || {}),
      },
    });

    if (res.ok) return res;

    const errorBody = await res.text();
    const lower = errorBody.toLowerCase();

    if (res.status === 403 || lower.includes("insufficient") || lower.includes("permission")) {
      throw new Error(`MICROSOFT_PERMISSION_REQUIRED:${errorBody}`);
    }

    if (isGraphRetryable(res.status, errorBody) && attempt < GRAPH_MAX_RETRIES) {
      await sleep(graphRetryDelayMs(res.headers, attempt));
      lastError = new Error(`Microsoft Graph error [${res.status}]: ${errorBody}`);
      continue;
    }

    throw new Error(`Microsoft Graph error [${res.status}]: ${errorBody}`);
  }

  throw lastError ?? new Error("Microsoft Graph: reintentos agotados");
}

async function graphRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await graphMailFetchWithRetry(accessToken, path, init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

async function refreshTokenIfNeeded(supabaseAdmin: any, userId: string, tokenRow: any) {
  const expiresAt = new Date(tokenRow.expires_at);
  // Refresh 5 min before expiry
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!.trim();

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: "refresh_token",
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from("microsoft_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRow.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return data.access_token;
}

/** Descarga metadatos + bytes del adjunto (fileAttachment) vía Graph /$value. */
async function loadMessageFileAttachmentFromGraph(
  accessToken: string,
  rawMessageId: string | undefined,
  rawAttachmentId: string | undefined,
): Promise<{
  body: Uint8Array;
  contentType: string;
  name: string;
  size?: unknown;
  isInline?: unknown;
  contentId?: unknown;
}> {
  const messageId = normalizeGraphMessageOrAttachmentId(rawMessageId);
  const attachmentId = normalizeGraphMessageOrAttachmentId(rawAttachmentId);
  if (!messageId || !attachmentId) {
    throw new Error("messageId y attachmentId son requeridos");
  }
  // No incluir contentId ni @odata.type en $select: Graph devuelve 400 (OData).
  const metaPath =
    `/me/messages/${messageId}/attachments/${attachmentId}?$select=id,name,contentType,size,isInline`;
  const att = await graphRequest(accessToken, metaPath, {
    headers: GRAPH_MAIL_PREFER_IMMUTABLE,
  });
  const odataType = (att as Record<string, unknown>)["@odata.type"] as string | undefined;
  if (odataType && String(odataType).includes("itemAttachment")) {
    throw new Error("Este tipo de adjunto no se puede previsualizar");
  }
  if (odataType && String(odataType).includes("referenceAttachment")) {
    throw new Error("Este tipo de adjunto no se puede previsualizar");
  }

  let contentType = String((att as Record<string, unknown>).contentType || "application/octet-stream");

  const valuePath = `/me/messages/${messageId}/attachments/${attachmentId}/$value`;
  const valueRes = await graphMailFetchWithRetry(accessToken, valuePath, {
    headers: {
      Accept: "application/octet-stream",
      ...GRAPH_MAIL_PREFER_IMMUTABLE,
    },
  });
  const buf = new Uint8Array(await valueRes.arrayBuffer());
  const hdr = valueRes.headers.get("content-type");
  if (hdr) {
    const main = hdr.split(";")[0].trim().toLowerCase();
    if (main && main !== "application/octet-stream") {
      contentType = hdr.split(";")[0].trim();
    }
  }

  return {
    body: buf,
    contentType,
    name: String((att as Record<string, unknown>).name ?? "adjunto"),
    size: (att as Record<string, unknown>).size,
    isInline: (att as Record<string, unknown>).isInline,
    contentId: (att as Record<string, unknown>).contentId,
  };
}

/** Lee como máximo `max` bytes y cancela el stream (evita bajar el PDF entero en el primer trozo). */
async function readFirstBytesFromStream(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  try {
    while (got < max) {
      const { value, done } = await reader.read();
      if (done) break;
      const v = value;
      if (got + v.length <= max) {
        chunks.push(v);
        got += v.length;
      } else {
        chunks.push(v.subarray(0, max - got));
        got = max;
        break;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub;

    // Get tokens using service role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("microsoft_tokens")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(JSON.stringify({ error: "Microsoft not connected", code: "NOT_CONNECTED" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshTokenIfNeeded(supabaseAdmin, userId, tokenRow);

    const body = await req.json();
    const { action, params } = body;

    let result;

    switch (action) {
      case "calendar-events": {
        const start = params?.start || new Date().toISOString();
        const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const res = await graphMailFetchWithRetry(
          accessToken,
          `/me/calendarview?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100`,
          {
            headers: {
              Prefer: 'outlook.timezone="America/Mexico_City"',
            },
          },
        );
        result = await res.json();
        break;
      }

      case "create-event": {
        const res = await graphMailFetchWithRetry(accessToken, `/me/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.event),
        });
        result = await res.json();
        break;
      }

      case "delete-event": {
        await graphMailFetchWithRetry(accessToken, `/me/events/${params.eventId}`, {
          method: "DELETE",
          headers: {},
        });
        result = { success: true };
        break;
      }

      case "event-detail": {
        const res = await graphMailFetchWithRetry(accessToken, `/me/events/${params.eventId}`, {
          headers: {
            Prefer: 'outlook.timezone="America/Mexico_City"',
          },
        });
        result = await res.json();
        break;
      }

      case "update-event": {
        const encodedEventId = encodeURIComponent(params.eventId);

        // Snapshot previo para fallback en ocurrencias recurrentes
        let beforeEvent: any = null;
        try {
          const beforeRes = await graphMailFetchWithRetry(accessToken, `/me/events/${encodedEventId}`, {
            headers: {},
          });
          beforeEvent = await beforeRes.json();
        } catch (be) {
          const bm = be instanceof Error ? be.message : String(be);
          if (!/\[404\]/.test(bm) && !bm.toLowerCase().includes("erroritemnotfound")) throw be;
        }

        const res = await graphMailFetchWithRetry(accessToken, `/me/events/${encodedEventId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Prefer: 'outlook.timezone="America/Mexico_City", return=representation',
          },
          body: JSON.stringify(params.payload),
        });

        const patchText = await res.text();
        const patchEvent: any = patchText ? JSON.parse(patchText) : null;

        // Verifica estado persistido (no confiar solo en respuesta del PATCH)
        let persistedEvent: any = null;
        try {
          const verifyRes = await graphMailFetchWithRetry(accessToken, `/me/events/${encodedEventId}`, {
            headers: {},
          });
          persistedEvent = await verifyRes.json();
        } catch (ve) {
          const vm = ve instanceof Error ? ve.message : String(ve);
          if (!/\[404\]/.test(vm) && !vm.toLowerCase().includes("erroritemnotfound")) throw ve;
        }
        const verifyOk = persistedEvent != null;

        const desiredStart = params?.payload?.start?.dateTime as string | undefined;
        const desiredEnd = params?.payload?.end?.dateTime as string | undefined;
        const appliedStart = persistedEvent?.start?.dateTime as string | undefined;
        const appliedEnd = persistedEvent?.end?.dateTime as string | undefined;

        // Si el evento ya no existe por ese ID, asumimos que Graph lo convirtió/reidentificó y sí aplicó
        const updateApplied = !verifyOk
          ? true
          : (!desiredStart || (appliedStart && appliedStart.startsWith(desiredStart))) &&
            (!desiredEnd || (appliedEnd && appliedEnd.startsWith(desiredEnd)));

        // Fallback para ocurrencias que no aceptan PATCH directo: clonar en nuevo horario y eliminar ocurrencia original
        if (!updateApplied && beforeEvent?.type === "occurrence") {
          const clonePayload: Record<string, any> = {
            subject: beforeEvent.subject,
            start: params?.payload?.start || beforeEvent.start,
            end: params?.payload?.end || beforeEvent.end,
            body: beforeEvent.body,
            attendees: beforeEvent.attendees,
            categories: beforeEvent.categories,
            isOnlineMeeting: !!beforeEvent.isOnlineMeeting,
            onlineMeetingProvider: beforeEvent.isOnlineMeeting ? "teamsForBusiness" : undefined,
            location: beforeEvent?.location?.displayName
              ? { displayName: beforeEvent.location.displayName }
              : undefined,
          };

          const createRes = await graphMailFetchWithRetry(accessToken, `/me/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(clonePayload),
          });

          const createdEvent = await createRes.json();

          try {
            await graphMailFetchWithRetry(accessToken, `/me/events/${encodedEventId}`, {
              method: "DELETE",
              headers: {},
            });
          } catch {
            /* ignorar si la ocurrencia ya no existe */
          }

          result = {
            ...createdEvent,
            migratedFromOccurrence: true,
            previousEventId: params.eventId,
          };
        } else {
          result = persistedEvent || patchEvent || { success: true };
        }

        break;
      }

      case "outlook-categories": {
        const res = await graphMailFetchWithRetry(accessToken, `/me/outlook/masterCategories`, {
          headers: {},
        });
        const json = await res.json();
        result = json.value || [];
        break;
      }

      case "emails": {
        /** Continuación oficial de Graph; con $search no se admite $skip en la misma petición. */
        if (params?.nextLink && typeof params.nextLink === "string") {
          const link = params.nextLink.trim();
          if (!link.startsWith("https://graph.microsoft.com/v1.0/")) {
            throw new Error("nextLink no permitido");
          }
          const u = new URL(link);
          const path = u.pathname.slice("/v1.0".length) + u.search;
          const q = u.search.toLowerCase();
          const needsSearchHeader = q.includes("$search") || q.includes("%24search");
          result = await graphRequest(accessToken, path, {
            headers: needsSearchHeader ? GRAPH_MAIL_SEARCH_HEADERS : GRAPH_MAIL_PREFER_IMMUTABLE,
          });
          break;
        }
        const top = params?.top || 25;
        const skip = params?.skip || 0;
        const folder = params?.folder || "inbox";
        const search = params?.search ? `&$search="${params.search}"` : "";
        const skipParam = skip > 0 ? `&$skip=${skip}` : "";
        const select =
          "$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,createdDateTime,isRead,hasAttachments,importance,conversationId";
        result = await graphRequest(
          accessToken,
          `/me/mailFolders/${folder}/messages?${select}&$top=${top}&$orderby=receivedDateTime desc&$count=true${skipParam}${search}`,
          { headers: params?.search ? GRAPH_MAIL_SEARCH_HEADERS : GRAPH_MAIL_PREFER_IMMUTABLE },
        );
        break;
      }

      case "mail-directory-sync": {
        const me = (await graphRequest(accessToken, "/me", {})) as Record<string, unknown>;
        const selfMail =
          typeof me.mail === "string" && me.mail.trim()
            ? me.mail.trim().toLowerCase()
            : typeof me.userPrincipalName === "string" && me.userPrincipalName.includes("@")
              ? me.userPrincipalName.trim().toLowerCase()
              : "";
        const rawTop = params?.top;
        const top =
          typeof rawTop === "number" && Number.isFinite(rawTop)
            ? Math.min(Math.max(Math.floor(rawTop), 1), 200)
            : 180;
        const select =
          "$select=from,toRecipients,ccRecipients,bccRecipients,receivedDateTime";
        const page = (await graphRequest(
          accessToken,
          `/me/messages?${select}&$top=${top}&$orderby=receivedDateTime desc`,
          { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
        )) as { value?: unknown[] };
        const map = new Map<string, { email: string; displayName: string }>();
        for (const m of page.value || []) {
          if (m && typeof m === "object") collectRecipientsFromMessage(m as Record<string, unknown>, map);
        }
        if (selfMail) map.delete(selfMail);
        result = { contacts: Array.from(map.values()) };
        break;
      }

      case "mark-unread": {
        await graphMailFetchWithRetry(accessToken, `/me/messages/${params.messageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isRead: false }),
        });
        result = { success: true };
        break;
      }

      case "archive-email": {
        const res = await graphMailFetchWithRetry(accessToken, `/me/messages/${params.messageId}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationId: "archive" }),
        });
        result = await res.json();
        break;
      }

      case "email-detail": {
        const mid = normalizeGraphMessageOrAttachmentId(params?.messageId);
        if (!mid) throw new Error("messageId required");
        result = await graphRequest(accessToken, `/me/messages/${mid}`, {
          headers: GRAPH_MAIL_PREFER_IMMUTABLE,
        });
        break;
      }

      case "send-email": {
        await graphMailFetchWithRetry(accessToken, `/me/sendMail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: params.message }),
        });
        result = { success: true };
        break;
      }

      case "check-connection": {
        result = await graphRequest(accessToken, "/me");
        break;
      }

      case "reply": {
        await graphMailFetchWithRetry(accessToken, `/me/messages/${params.messageId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: params.comment }),
        });
        result = { success: true };
        break;
      }

      case "reply-all": {
        await graphMailFetchWithRetry(accessToken, `/me/messages/${params.messageId}/replyAll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: params.comment }),
        });
        result = { success: true };
        break;
      }

      case "mark-read": {
        await graphRequest(
          accessToken,
          `/me/messages/${params.messageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isRead: true }),
          }
        );
        result = { success: true };
        break;
      }

      case "create-onedrive-doc": {
        const docType = params.docType || "docx";
        const fileName = params.fileName || `Documento.${docType}`;
        const folderPath = params.folderPath || "Kawiil";

        const getItemByPath = async (path: string) => {
          try {
            const res = await graphMailFetchWithRetry(accessToken, `/me/drive/root:/${encodeURI(path)}`, {
              headers: {},
            });
            return await res.json();
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (/\[404\]/.test(m)) return null;
            throw e;
          }
        };

        const ensureFolderPathExists = async (path: string) => {
          const segments = path.split("/").filter(Boolean);
          let currentPath = "";

          for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const existing = await getItemByPath(currentPath);
            if (existing) continue;

            const parentPath = currentPath.includes("/")
              ? currentPath.slice(0, currentPath.lastIndexOf("/"))
              : "";

            const createPath = parentPath
              ? `/me/drive/root:/${encodeURI(parentPath)}:/children`
              : `/me/drive/root/children`;

            try {
              const createRes = await graphMailFetchWithRetry(accessToken, createPath, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: segment,
                  folder: {},
                  "@microsoft.graph.conflictBehavior": "fail",
                }),
              });
              await createRes.text();
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              if (!/\[409\]/.test(m)) throw e;
            }
          }
        };

        await ensureFolderPathExists(folderPath);

        const mimeTypes: Record<string, string> = {
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        };

        const putHeaders = { "Content-Type": mimeTypes[docType] || "application/octet-stream" };
        let putRes: Response;
        try {
          putRes = await graphMailFetchWithRetry(
            accessToken,
            `/me/drive/root:/${encodeURI(folderPath)}/${encodeURIComponent(fileName)}:/content`,
            {
              method: "PUT",
              headers: putHeaders,
              body: new Uint8Array(0),
            },
          );
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          if (!/\[404\]/.test(m)) throw e;
          putRes = await graphMailFetchWithRetry(
            accessToken,
            `/me/drive/root:/${encodeURIComponent(fileName)}:/content`,
            {
              method: "PUT",
              headers: putHeaders,
              body: new Uint8Array(0),
            },
          );
        }

        const createdFile = await putRes.json();
        result = {
          success: true,
          id: createdFile.id,
          name: createdFile.name,
          webUrl: createdFile.webUrl,
          parentPath: createdFile.parentReference?.path,
        };
        break;
      }

      case "forward": {
        await graphMailFetchWithRetry(accessToken, `/me/messages/${params.messageId}/forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            comment: params.comment,
            toRecipients: params.toRecipients,
          }),
        });
        result = { success: true };
        break;
      }

      case "inbox-folder-meta": {
        result = await graphRequest(
          accessToken,
          "/me/mailFolders/inbox?$select=id,unreadItemCount,totalItemCount"
        );
        break;
      }

      case "mail-folders": {
        const all: unknown[] = [];
        let path = "/me/mailFolders?$top=100";
        const maxPages = 25;
        for (let page = 0; page < maxPages; page++) {
          const data = (await graphRequest(accessToken, path)) as {
            value?: unknown[];
            "@odata.nextLink"?: string;
          };
          if (Array.isArray(data?.value)) {
            for (const v of data.value) all.push(v);
          }
          const nl = data?.["@odata.nextLink"];
          if (typeof nl !== "string" || !nl) break;
          const m = nl.match(/graph\.microsoft\.com\/v1\.0(\/.+)/i);
          path = m?.[1] ?? "";
          if (!path) break;
        }
        result = all;
        break;
      }

      case "email-conversation": {
        const convId = params?.conversationId;
        if (!convId) throw new Error("conversationId required");
        const safeConvId = String(convId).replace(/"/g, "");
        const convSelect =
          "$select=id,conversationId,subject,bodyPreview,body,from,receivedDateTime,sentDateTime,isRead,hasAttachments";
        // $search requiere ConsistencyLevel eventual; $select aporta body para el hilo en UI
        const data = await graphRequest(
          accessToken,
          `/me/messages?${convSelect}&$search="conversationId:${safeConvId}"&$top=50`,
          { headers: GRAPH_MAIL_SEARCH_HEADERS },
        );
        result = data?.value || [];
        break;
      }

      case "create-reply-draft": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        if (!messageId) throw new Error("messageId required");
        const replyAll = params?.replyAll || false;
        const endpoint = replyAll ? "createReplyAll" : "createReply";
        try {
          const res = await graphMailFetchWithRetry(
            accessToken,
            `/me/messages/${messageId}/${endpoint}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", ...GRAPH_MAIL_PREFER_IMMUTABLE },
              body: JSON.stringify({ comment: "" }),
            },
          );
          result = await res.json();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const errBody = msg.replace(/^Microsoft Graph error \[\d+\]: /, "");
          let graphCode: string | undefined;
          try {
            const j = JSON.parse(errBody);
            graphCode = j?.error?.code;
          } catch {
            /* ignore */
          }
          /** Algunos mensajes (borradores, carpetas especiales, tipos raros) no admiten createReply en Graph. */
          const lower = errBody.toLowerCase();
          const invalidRef =
            graphCode === "ErrorInvalidReferenceItem" ||
            graphCode === "ErrorItemNotFound" ||
            lower.includes("errorinvalidreferenceitem") ||
            lower.includes("erroritemnotfound");
          if (invalidRef) {
            result = {
              code: "REFERENCE_NOT_SUPPORTED",
              error:
                "Este mensaje no admite respuesta con borrador. Puedes escribir y enviar; se usará envío simple.",
            };
            break;
          }
          throw e;
        }
        break;
      }

      /** Borrador de reenvío (incluye plantilla y firma de Outlook como en el cliente). */
      case "create-forward-draft": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        if (!messageId) throw new Error("messageId required");
        const res = await graphMailFetchWithRetry(accessToken, `/me/messages/${messageId}/createForward`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...GRAPH_MAIL_PREFER_IMMUTABLE },
          body: JSON.stringify({ comment: "" }),
        });
        result = await res.json();
        break;
      }

      /**
       * Firma para “Nuevo correo”: Graph no expone la firma HTML de Outlook de forma oficial.
       * Solo GET /me (perfil Microsoft). No creamos borradores aquí (evita 400/500 y confusión con otras acciones).
       */
      case "get-email-signature-html": {
        const escapeHtml = (s: string) =>
          s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const me = await graphRequest(
          accessToken,
          "/me?$select=displayName,mail,userPrincipalName,jobTitle,mobilePhone,officeLocation",
        );
        const displayName = String(me?.displayName || "").trim();
        const mail = String(me?.mail || me?.userPrincipalName || "").trim();
        const title = String(me?.jobTitle || "").trim();
        const phone = String(me?.mobilePhone || "").trim();
        const office = String(me?.officeLocation || "").trim();

        let fallbackHtml = `<p><br></p><p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#333;">`;
        if (displayName) fallbackHtml += `<strong>${escapeHtml(displayName)}</strong><br/>`;
        if (title) fallbackHtml += `${escapeHtml(title)}<br/>`;
        if (office) fallbackHtml += `${escapeHtml(office)}<br/>`;
        if (mail) {
          fallbackHtml += `<a href="mailto:${escapeHtml(mail)}">${escapeHtml(mail)}</a>`;
        }
        if (phone) fallbackHtml += `<br/>${escapeHtml(phone)}`;
        fallbackHtml += `</p>`;

        result = { html: fallbackHtml, source: "microsoft_profile", displayName, mail };
        break;
      }

      case "update-draft": {
        const draftId = normalizeGraphMessageOrAttachmentId(params?.draftId);
        if (!draftId) throw new Error("draftId required");
        const payload = params?.payload;
        await graphRequest(accessToken, `/me/messages/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...GRAPH_MAIL_PREFER_IMMUTABLE },
          body: JSON.stringify(payload),
        });
        result = { success: true };
        break;
      }

      case "send-draft": {
        const draftId = normalizeGraphMessageOrAttachmentId(params?.draftId);
        if (!draftId) throw new Error("draftId required");
        await graphMailFetchWithRetry(accessToken, `/me/messages/${draftId}/send`, {
          method: "POST",
          headers: { ...GRAPH_MAIL_PREFER_IMMUTABLE },
        });
        result = { success: true };
        break;
      }

      case "add-draft-attachment": {
        const draftId = normalizeGraphMessageOrAttachmentId(params?.draftId);
        const attachment = params?.attachment;
        if (!draftId || !attachment?.name || !attachment?.contentBytes) {
          throw new Error("draftId y attachment son requeridos");
        }
        await graphRequest(accessToken, `/me/messages/${draftId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...GRAPH_MAIL_PREFER_IMMUTABLE },
          body: JSON.stringify({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.name,
            contentType: attachment.contentType || "application/octet-stream",
            contentBytes: attachment.contentBytes,
          }),
        });
        result = { success: true };
        break;
      }

      case "move-email": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        const destinationId = params?.destinationId;
        if (!messageId || !destinationId) throw new Error("messageId and destinationId required");
        result = await graphRequest(accessToken, `/me/messages/${messageId}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...GRAPH_MAIL_PREFER_IMMUTABLE },
          body: JSON.stringify({ destinationId }),
        });
        break;
      }

      case "delete-email": {
        const messageId = params?.messageId;
        if (!messageId) throw new Error("messageId required");
        await graphMailFetchWithRetry(accessToken, `/me/messages/${messageId}`, {
          method: "DELETE",
          headers: {},
        });
        result = { success: true };
        break;
      }

      case "message-attachment-content": {
        /** JSON + base64: puede superar límites del gateway; preferir message-attachment-binary en el cliente. */
        const r = await loadMessageFileAttachmentFromGraph(accessToken, params?.messageId, params?.attachmentId);
        result = {
          name: r.name,
          contentType: r.contentType,
          contentBytes: uint8ArrayToBase64(r.body),
          size: r.size,
          isInline: r.isInline,
          contentId: r.contentId,
        };
        break;
      }

      /** Cuerpo binario sin base64; reenvía el stream de Graph (sin bufferizar el PDF en la edge). */
      case "message-attachment-binary": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        const attachmentId = normalizeGraphMessageOrAttachmentId(params?.attachmentId);
        if (!messageId || !attachmentId) {
          throw new Error("messageId y attachmentId son requeridos");
        }
        const metaPath =
          `/me/messages/${messageId}/attachments/${attachmentId}?$select=id,name,contentType,size,isInline`;
        const att = await graphRequest(accessToken, metaPath, {
          headers: GRAPH_MAIL_PREFER_IMMUTABLE,
        });
        const odataType = (att as Record<string, unknown>)["@odata.type"] as string | undefined;
        if (odataType && String(odataType).includes("itemAttachment")) {
          throw new Error("Este tipo de adjunto no se puede previsualizar");
        }
        if (odataType && String(odataType).includes("referenceAttachment")) {
          throw new Error("Este tipo de adjunto no se puede previsualizar");
        }

        let contentType = String((att as Record<string, unknown>).contentType || "application/octet-stream");
        const name = String((att as Record<string, unknown>).name ?? "adjunto");

        const valuePathBin = `/me/messages/${messageId}/attachments/${attachmentId}/$value`;
        const valueRes = await graphMailFetchWithRetry(accessToken, valuePathBin, {
          headers: {
            Accept: "application/octet-stream",
            ...GRAPH_MAIL_PREFER_IMMUTABLE,
          },
        });
        const hdr = valueRes.headers.get("content-type");
        if (hdr) {
          const main = hdr.split(";")[0].trim().toLowerCase();
          if (main && main !== "application/octet-stream") {
            contentType = hdr.split(";")[0].trim();
          }
        }

        const streamBody = valueRes.body;
        if (!streamBody) {
          const buf = new Uint8Array(await valueRes.arrayBuffer());
          return new Response(buf, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": contentType || "application/octet-stream",
              "X-Kawiil-Attachment-Name": encodeURIComponent(name),
              "Access-Control-Expose-Headers": "Content-Type, X-Kawiil-Attachment-Name",
            },
          });
        }

        return new Response(streamBody, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": contentType || "application/octet-stream",
            "X-Kawiil-Attachment-Name": encodeURIComponent(name),
            "Access-Control-Expose-Headers": "Content-Type, X-Kawiil-Attachment-Name",
          },
        });
      }

      /**
       * Trozos en JSON (base64) para cuando binario/stream falla en el cliente o el gateway trunca.
       * Usa Range en Graph si responde 206; si no, solo byteStart=0 con lectura parcial + cancel.
       */
      case "message-attachment-chunk": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        const attachmentId = normalizeGraphMessageOrAttachmentId(params?.attachmentId);
        const byteStart = Math.max(0, Math.floor(Number(params?.byteStart ?? 0)));
        const maxLen = Math.min(Math.max(1, Math.floor(Number(params?.maxLength ?? 196608))), 262144);
        if (!messageId || !attachmentId) {
          throw new Error("messageId y attachmentId son requeridos");
        }

        const metaPath =
          `/me/messages/${messageId}/attachments/${attachmentId}?$select=id,name,contentType,size`;
        const att = await graphRequest(accessToken, metaPath, {
          headers: GRAPH_MAIL_PREFER_IMMUTABLE,
        });
        const odataType = (att as Record<string, unknown>)["@odata.type"] as string | undefined;
        if (odataType && String(odataType).includes("itemAttachment")) {
          throw new Error("Este tipo de adjunto no se puede previsualizar");
        }
        if (odataType && String(odataType).includes("referenceAttachment")) {
          throw new Error("Este tipo de adjunto no se puede previsualizar");
        }

        let contentType = String((att as Record<string, unknown>).contentType || "application/octet-stream");
        const name = String((att as Record<string, unknown>).name ?? "adjunto");
        const totalFromMeta =
          typeof (att as Record<string, unknown>).size === "number"
            ? Number((att as Record<string, unknown>).size)
            : null;

        const valuePathChunk = `/me/messages/${messageId}/attachments/${attachmentId}/$value`;
        const rangeEnd = byteStart + maxLen - 1;

        /** No enviar Range en el primer trozo: Graph/Exchange a veces responde 416 o cuerpo vacío con bytes=0-… */
        const chunkHeaders: Record<string, string> = {
          Accept: "application/octet-stream",
          ...GRAPH_MAIL_PREFER_IMMUTABLE,
        };
        if (byteStart > 0) {
          chunkHeaders.Range = `bytes=${byteStart}-${rangeEnd}`;
        }

        const valueRes = await graphMailFetchWithRetry(accessToken, valuePathChunk, {
          headers: chunkHeaders,
        });

        let buf: Uint8Array;
        let totalSize: number | null = totalFromMeta;

        if (valueRes.status === 206) {
          buf = new Uint8Array(await valueRes.arrayBuffer());
          const cr = valueRes.headers.get("content-range");
          if (cr) {
            const m = cr.match(/\/(\d+)\s*$/);
            if (m) totalSize = parseInt(m[1], 10);
          }
          const hdr = valueRes.headers.get("content-type");
          if (hdr) {
            const main = hdr.split(";")[0].trim().toLowerCase();
            if (main && main !== "application/octet-stream") {
              contentType = hdr.split(";")[0].trim();
            }
          }
        } else if (valueRes.status === 200 && byteStart === 0) {
          const streamBody = valueRes.body;
          if (!streamBody) {
            buf = new Uint8Array(await valueRes.arrayBuffer());
          } else {
            buf = await readFirstBytesFromStream(streamBody, maxLen);
          }
          const hdr = valueRes.headers.get("content-type");
          if (hdr) {
            const main = hdr.split(";")[0].trim().toLowerCase();
            if (main && main !== "application/octet-stream") {
              contentType = hdr.split(";")[0].trim();
            }
          }
          if (totalSize == null) {
            const cl = valueRes.headers.get("content-length");
            const n = cl ? parseInt(cl, 10) : NaN;
            if (Number.isFinite(n)) totalSize = n;
          }
        } else if (valueRes.status === 200 && byteStart > 0) {
          if (totalFromMeta != null && totalFromMeta <= 6 * 1024 * 1024) {
            const full = new Uint8Array(await valueRes.arrayBuffer());
            if (byteStart >= full.length) {
              buf = new Uint8Array(0);
            } else {
              buf = full.subarray(byteStart, Math.min(byteStart + maxLen, full.length));
            }
            totalSize = totalFromMeta;
            const hdr = valueRes.headers.get("content-type");
            if (hdr) {
              const main = hdr.split(";")[0].trim().toLowerCase();
              if (main && main !== "application/octet-stream") {
                contentType = hdr.split(";")[0].trim();
              }
            }
          } else {
            const errText = await valueRes.text();
            throw new Error(
              `Graph no devolvió 206 en offset ${byteStart} (Range). ${errText.slice(0, 120)}`,
            );
          }
        } else {
          const errText = await valueRes.text();
          throw new Error(`Adjunto chunk [${valueRes.status}]: ${errText}`);
        }

        const done =
          buf.length === 0 ||
          (totalSize != null && byteStart + buf.length >= totalSize) ||
          (totalSize == null && buf.length < maxLen);

        result = {
          name,
          contentType,
          byteStart,
          length: buf.length,
          totalSize,
          partBase64: uint8ArrayToBase64(buf),
          done,
        };
        break;
      }

      case "email-attachments": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        if (!messageId) throw new Error("messageId required");
        result = await graphRequest(
          accessToken,
          `/me/messages/${messageId}/attachments?$top=100`,
          { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
        );
        break;
      }

      case "create-mail-folder": {
        const displayName = params?.displayName;
        if (!displayName) throw new Error("displayName required");
        const res = await graphMailFetchWithRetry(accessToken, `/me/mailFolders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        });
        result = await res.json();
        break;
      }
    }

    if (result === undefined) {
      return new Response(
        JSON.stringify({
          error:
            "Acción no reconocida o microsoft-api desactualizada. Despliega: supabase functions deploy microsoft-api --no-verify-jwt",
          code: "UNKNOWN_ACTION",
          action: action ?? null,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Microsoft API error:", error);
    const message = (error as Error).message || "Unknown error";
    const lower = message.toLowerCase();
    /** Red de seguridad: si createReply escapó sin mapear, no devolver 500 (evita runtime en cliente / Lovable). */
    if (lower.includes("createreplydraft") && lower.includes("errorinvalidreferenceitem")) {
      return new Response(
        JSON.stringify({
          code: "REFERENCE_NOT_SUPPORTED",
          error:
            "Este mensaje no admite respuesta con borrador. Puedes escribir y enviar; se usará envío simple.",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (message.startsWith("MICROSOFT_PERMISSION_REQUIRED:")) {
      return new Response(JSON.stringify({
        error: "Tu conexión de Microsoft no tiene los permisos necesarios. Reconecta Microsoft para aplicar los permisos nuevos.",
        code: "PERMISSION_REQUIRED",
        details: message.replace("MICROSOFT_PERMISSION_REQUIRED:", ""),
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle 404 - item not found (e.g. stale recurring event occurrence)
    if (message.includes("[404]") || message.includes("ErrorItemNotFound")) {
      return new Response(JSON.stringify({
        error: "El elemento no fue encontrado. Es posible que haya sido eliminado o modificado. Recarga la vista para actualizar.",
        code: "ITEM_NOT_FOUND",
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (
      lower.includes("applicationthrottled") ||
      lower.includes("mailboxconcurrency") ||
      message.includes("[429]")
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Microsoft limitó temporalmente las peticiones al buzón. Espera unos segundos y vuelve a intentar.",
          code: "GRAPH_THROTTLED",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
