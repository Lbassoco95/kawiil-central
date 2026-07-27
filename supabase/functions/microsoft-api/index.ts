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
  if (!text) return { success: true };
  try {
    return JSON.parse(text);
  } catch (parseErr) {
    const snippet = text.slice(0, 280);
    const pe = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(
      `Microsoft Graph respuesta no JSON (${path.slice(0, 180)}…): ${pe}; body=${snippet}`,
    );
  }
}

/** Comparación robusta de nombres de carpeta (middots unicode, espacios). */
function normalizeMailFolderDisplayName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\u00b7\u2219\u2022\u30fb\u318d\ufe52]/g, "\u00b7");
}

const MAIL_FOLDER_LIST_SELECT =
  "id,displayName,parentFolderId,wellKnownFolderName,unreadItemCount,totalItemCount,childFolderCount";
/** Raíz: incluye carpetas ocultas (paridad con Outlook). Graph soporta $top=1000 en mailFolders. */
const MAIL_FOLDER_ROOT_LIST_QUERY =
  `?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000&includeHiddenFolders=true`;
/** Hijos: mismo flag que la raíz; sin él Graph puede omitir subcarpetas que el usuario sí ve en Outlook. */
const MAIL_FOLDER_CHILD_LIST_QUERY =
  `?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000&includeHiddenFolders=true`;
/** Algunos tenants devuelven 400 al combinar $select + includeHiddenFolders en raíz o en `childFolders`; se reintenta sin el flag. */
const MAIL_FOLDER_ROOT_LIST_QUERY_PLAIN = `?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000`;
const MAIL_FOLDER_CHILD_LIST_QUERY_PLAIN = `?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000`;

/** Listado plano solo nivel raíz, con $select para obtener wellKnownFolderName y childFolderCount. */
async function listMailFoldersRootOnlyLegacy(accessToken: string): Promise<unknown[]> {
  const all: unknown[] = [];
  // Try with $select first (needed to get wellKnownFolderName and childFolderCount).
  // Some tenants reject includeHiddenFolders, so we don't add it here.
  const strategies = [
    `/me/mailFolders?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000`,
    `/me/mailFolders?$top=1000`,
  ];
  for (const startPath of strategies) {
    all.length = 0;
    let path: string | null = startPath;
    const maxPages = 25;
    let ok = true;
    try {
      for (let page = 0; page < maxPages && path; page++) {
        const data = (await graphRequest(accessToken, path)) as {
          value?: unknown[];
          "@odata.nextLink"?: string;
        };
        if (Array.isArray(data?.value)) {
          for (const v of data.value) all.push(v);
        }
        const nl = data?.["@odata.nextLink"];
        path = typeof nl === "string" && nl ? nextLinkToPath(nl) : null;
      }
    } catch (e) {
      console.warn("[microsoft-api] listMailFoldersRootOnlyLegacy strategy failed", String(e).slice(0, 200));
      ok = false;
    }
    if (ok && all.length > 0) break;
  }
  return all;
}

function nextLinkToPath(nextLink: string): string {
  const m = nextLink.match(/graph\.microsoft\.com\/v1\.0(\/.+)/i);
  return m?.[1] ?? "";
}

/** Si conviene encolar /childFolders: hijos anunciados, contador ausente, o Inbox con `childFolderCount: 0` (Graph a veces desincroniza). */
function rowSuggestsChildFolderProbe(row: Record<string, unknown>): boolean {
  const cc = row.childFolderCount;
  if (typeof cc === "number" && cc > 0) return true;
  if (typeof cc !== "number") return true;
  if (cc === 0) {
    const wk = String(row.wellKnownFolderName || "").toLowerCase();
    if (wk === "inbox") return true;
  }
  return false;
}

type ListAllMailFoldersMeta = {
  /** Se alcanzó MAX_FOLDERS o MAX_GRAPH_LIST_CALLS. */
  truncated: boolean;
  /** Fallos al listar /childFolders de un padre (se siguió con el resto del buzón). */
  partialChildErrors: number;
};

/**
 * Todas las carpetas del buzón (raíz + subcarpetas vía childFolders), aplanadas.
 * Incluye carpetas ocultas (paridad Outlook). Límites para evitar timeouts en buzones enormes.
 * Un error en un solo `childFolders` no aborta todo el listado.
 */
async function listAllMailFoldersRecursive(accessToken: string): Promise<{
  folders: unknown[];
  rootFolderIds: Set<string>;
  meta: ListAllMailFoldersMeta;
}> {
  const MAX_FOLDERS = 5000;
  const MAX_GRAPH_LIST_CALLS = 900;
  let listCalls = 0;
  let partialChildErrors = 0;

  const all: unknown[] = [];
  const seenIds = new Set<string>();
  const rootFolderIds = new Set<string>();
  /** Cola BFS: ids de carpeta cuyos hijos faltan por listar. */
  const childQueue: string[] = [];
  const enqueuedChildren = new Set<string>();

  const graphList = async (path: string): Promise<{
    value?: unknown[];
    "@odata.nextLink"?: string;
  } | null> => {
    if (listCalls >= MAX_GRAPH_LIST_CALLS) return null;
    listCalls += 1;
    return (await graphRequest(accessToken, path)) as {
      value?: unknown[];
      "@odata.nextLink"?: string;
    };
  };

  const ingestFolderRow = (row: Record<string, unknown>, isRootLevel: boolean) => {
    const id = row.id;
    if (typeof id !== "string" || !id || seenIds.has(id)) return;
    seenIds.add(id);
    all.push(row);
    if (isRootLevel) rootFolderIds.add(id);

    if (
      rowSuggestsChildFolderProbe(row) &&
      all.length < MAX_FOLDERS &&
      listCalls < MAX_GRAPH_LIST_CALLS
    ) {
      if (!enqueuedChildren.has(id)) {
        enqueuedChildren.add(id);
        childQueue.push(id);
      }
    }
  };

  const paginateInto = async (firstPath: string, isRootLevel: boolean) => {
    let path: string | null = firstPath;
    for (let page = 0; page < 25 && all.length < MAX_FOLDERS && path; page++) {
      const data = await graphList(path);
      if (!data) break;
      if (Array.isArray(data.value)) {
        for (const v of data.value) {
          if (!v || typeof v !== "object") continue;
          ingestFolderRow(v as Record<string, unknown>, isRootLevel);
          if (all.length >= MAX_FOLDERS) break;
        }
      }
      const nl = data["@odata.nextLink"];
      path = typeof nl === "string" && nl ? nextLinkToPath(nl) : null;
    }
  };

  const listChildFolderPages = async (parentId: string) => {
    const enc = encodeURIComponent(parentId);
    const childBase = `/me/mailFolders/${enc}/childFolders`;
    try {
      await paginateInto(`${childBase}${MAIL_FOLDER_CHILD_LIST_QUERY}`, false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await paginateInto(`${childBase}${MAIL_FOLDER_CHILD_LIST_QUERY_PLAIN}`, false);
        if (!/\[400\]/.test(msg)) {
          console.warn(
            "[microsoft-api] listAllMailFoldersRecursive: childFolders primera petición falló, plain funcionó",
            { parentId, firstErr: msg.slice(0, 380) },
          );
        }
      } catch (e2) {
        partialChildErrors += 1;
        console.warn(
          "[microsoft-api] listAllMailFoldersRecursive: childFolders con/sin hidden fallaron, se omite subárbol",
          {
            parentId,
            first: msg.slice(0, 380),
            second: e2 instanceof Error ? e2.message.slice(0, 380) : String(e2),
          },
        );
      }
    }
  };

  const rootPaths = [
    { path: `/me/mailFolders${MAIL_FOLDER_ROOT_LIST_QUERY}`, label: "root_with_includeHiddenFolders" },
    { path: `/me/mailFolders${MAIL_FOLDER_ROOT_LIST_QUERY_PLAIN}`, label: "root_plain_select" },
    { path: `/me/mailFolders?$top=100`, label: "root_minimal" },
  ];
  let rootListed = false;
  for (let ri = 0; ri < rootPaths.length; ri++) {
    const { path: rootPath, label } = rootPaths[ri];
    try {
      await paginateInto(rootPath, true);
      rootListed = true;
      if (ri > 0) {
        console.warn("[microsoft-api] listAllMailFoldersRecursive: raíz con estrategia alternativa", {
          strategy: label,
        });
      }
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isLast = ri === rootPaths.length - 1;
      if (isLast) {
        console.error("[microsoft-api] listAllMailFoldersRecursive: todas las estrategias de raíz fallaron", {
          lastStrategy: label,
          err: msg.slice(0, 800),
        });
        throw e;
      }
      console.warn("[microsoft-api] listAllMailFoldersRecursive: estrategia de raíz falló, siguiente", {
        failedStrategy: label,
        err: msg.slice(0, 400),
      });
    }
  }
  if (!rootListed) {
    throw new Error("listAllMailFoldersRecursive: raíz no listada (estado inconsistente)");
  }

  while (
    childQueue.length > 0 &&
    all.length < MAX_FOLDERS &&
    listCalls < MAX_GRAPH_LIST_CALLS
  ) {
    const parentId = childQueue.shift();
    if (!parentId) break;
    await listChildFolderPages(parentId);
  }

  const truncated = all.length >= MAX_FOLDERS || listCalls >= MAX_GRAPH_LIST_CALLS;
  if (truncated) {
    console.warn("[microsoft-api] listAllMailFoldersRecursive: listado truncado por límites", {
      folderCount: all.length,
      listCalls,
      partialChildErrors,
    });
  } else if (partialChildErrors > 0) {
    console.warn("[microsoft-api] listAllMailFoldersRecursive: resumen (sin truncar global)", {
      folderCount: all.length,
      listCalls,
      partialChildErrors,
    });
  }

  return {
    folders: all,
    rootFolderIds,
    meta: { truncated, partialChildErrors },
  };
}

async function findRootMailFolderByDisplayName(
  accessToken: string,
  wanted: string,
): Promise<Record<string, unknown> | null> {
  const target = normalizeMailFolderDisplayName(wanted);
  const { folders, rootFolderIds } = await listAllMailFoldersRecursive(
    accessToken,
  );
  for (const f of folders) {
    if (!f || typeof f !== "object") continue;
    const row = f as { id?: string; displayName?: string };
    if (typeof row.id !== "string" || typeof row.displayName !== "string") continue;
    if (!rootFolderIds.has(row.id)) continue;
    if (normalizeMailFolderDisplayName(row.displayName) === target) return f as Record<string, unknown>;
  }
  return null;
}

function graphErrorCodeFromThrownMessage(msg: string): string | undefined {
  const m = msg.match(/"code"\s*:\s*"([^"]+)"/);
  return m?.[1];
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

/**
 * Sincroniza la foto de Microsoft para `targetUserId` usando un access token ya válido.
 * Retorna el mismo shape que la acción sync-profile-photo. Usado tanto por la acción
 * individual como por el backfill masivo de una organización.
 */
async function syncProfilePhotoFor(
  supabaseAdmin: any,
  targetUserId: string,
  accessToken: string,
): Promise<
  | { code: "NO_PHOTO" }
  | { url: string; source: "microsoft"; contentType: string }
> {
  let photoRes: Response;
  try {
    photoRes = await graphMailFetchWithRetry(accessToken, "/me/photo/$value", {
      headers: { Accept: "image/*" },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const lower = m.toLowerCase();
    if (
      /\[404\]/.test(m) ||
      lower.includes("imagenotfound") ||
      lower.includes("resourcenotfound") ||
      lower.includes("itemnotfound")
    ) {
      return { code: "NO_PHOTO" };
    }
    throw e;
  }

  const contentType = photoRes.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await photoRes.arrayBuffer());
  if (bytes.length === 0) return { code: "NO_PHOTO" };

  const ext = contentType.toLowerCase().includes("png")
    ? "png"
    : contentType.toLowerCase().includes("gif")
      ? "gif"
      : "jpg";
  const path = `${targetUserId}/microsoft.${ext}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from("avatars")
    .upload(path, bytes, {
      contentType,
      upsert: true,
      cacheControl: "3600",
    });
  if (upErr) {
    throw new Error(`Avatar upload failed: ${upErr.message || String(upErr)}`);
  }

  const { data: pub } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: profileErr } = await supabaseAdmin
    .from("profiles")
    .update({ avatar_url: url })
    .eq("user_id", targetUserId);
  if (profileErr) {
    throw new Error(`Profile update failed: ${profileErr.message || String(profileErr)}`);
  }

  return { url, source: "microsoft", contentType };
}

/**
 * Firma en “Nuevo correo”: Microsoft Graph no expone el HTML de firma de Outlook/OWA de forma oficial.
 * Orden aplicado en get-email-signature-html: 1) columna Kawiil (profiles) 2) inferencia Enviados 3) /me
 */
function stripQuotedThreadFromBodyHtml(html: string): string {
  if (!html || html.length < 24) return html;
  const lower = html.toLowerCase();
  const markers = [
    'id="divrplyfwdmsg"',
    "id='divrplyfwdmsg'",
    "id=\"divrplyfwdmsg\"",
    "-----original message-----",
    "-----mensaje original-----",
    'class="gmail_quote"',
    "class='gmail_quote'",
  ];
  let cut = html.length;
  for (const m of markers) {
    const idx = lower.indexOf(m);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return cut < html.length && cut > 12 ? html.slice(0, cut) : html;
}

/** Limpia un fragmento de HTML de firma para que sea seguro para TipTap. */
function sanitizeSignatureFragment(raw: string): string {
  if (!raw) return "";
  let s = raw;
  s = s.replace(/<\?xml[^>]*\?>/gi, "");
  s = s.replace(/<!DOCTYPE[^>]*>/gi, "");
  s = s.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "");
  s = s.replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, "");
  s = s.replace(/<[a-z]+:[a-z][^>]*\/>/gi, "");
  s = s.replace(/<([a-z]+:[a-z][^>]*)>([\s\S]*?)<\/[a-z]+:[a-z]+>/gi, "$2");
  s = s.replace(/<\/?[a-z]+:[^>]*>/gi, "");
  s = s.replace(/<\/?html[^>]*>/gi, "");
  s = s.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<\/?body[^>]*>/gi, "");
  s = s.replace(/<meta[^>]*\/?>/gi, "");
  s = s.replace(/<link[^>]*\/?>/gi, "");
  s = s.replace(/<base[^>]*\/?>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "<br>");
  s = s.trim();
  // If the slice starts mid-attribute (e.g. "rection:ltr;...>"), skip to the first valid tag.
  if (s && !s.startsWith("<")) {
    const firstTag = s.indexOf("<");
    if (firstTag !== -1) s = s.slice(firstTag);
    else return "";
  }
  return s.trim();
}

function inferSignatureFromSentBodies(
  contents: string[],
): { html: string; confidence: "high" | "low" } | null {
  if (contents.length < 2) return null;
  const stripped = contents.map(stripQuotedThreadFromBodyHtml);
  const tails = stripped.map((s) => s.slice(-Math.min(5000, Math.max(0, s.length))));
  for (let len = 2000; len >= 120; len -= 40) {
    for (const t of tails) {
      if (t.length < len) continue;
      const end = t.slice(-len);
      if (end.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim().length < 28) continue;
      const n = tails.filter((x) => x.endsWith(end)).length;
      if (n >= 2) {
        const hasContact = /mailto:|@[a-z0-9.\-]+\.[a-z]{2,}/i.test(end);
        const rawHtml = end.trim().startsWith("<") ? end.trim() : `<p>${end.trim()}</p>`;
        const html = sanitizeSignatureFragment(rawHtml);
        if (!html) continue; // skip if sanitation removed everything
        return { html, confidence: hasContact ? "high" : "low" };
      }
    }
  }
  return null;
}

async function fetchRecentSentMessageBodies(
  accessToken: string,
  max: number,
): Promise<string[]> {
  const path =
    `/me/mailFolders/sentitems/messages?` +
    `$top=${max}` +
    `&$orderby=createdDateTime%20desc` +
    `&$select=body,subject`;
  let data: { value?: Array<{ body?: { content?: string; contentType?: string } }> };
  try {
    data = (await graphRequest(accessToken, path, {
      headers: GRAPH_MAIL_PREFER_IMMUTABLE,
    })) as { value?: Array<{ body?: { content?: string; contentType?: string } }> };
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of data.value || []) {
    const ct = String(m?.body?.contentType || "").toLowerCase();
    const c = m?.body?.content;
    if (typeof c !== "string" || c.length < 40) continue;
    if (ct.includes("text") && !ct.includes("html")) continue;
    out.push(c);
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

    const body = await req.json();
    const { action, params } = body;

    /**
     * Backfill masivo de fotos de la organización del invocador. No requiere
     * que el admin tenga Microsoft conectado: sólo permisos admin/manager.
     * Recorre todos los usuarios de la org con `microsoft_tokens` y sincroniza
     * su foto (refresca token si hace falta). No aborta ante errores puntuales.
     */
    if (action === "backfill-org-photos") {
      const { data: isAdmin } = await supabaseAdmin.rpc("is_admin_or_manager", { _user_id: userId });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: orgId } = await supabaseAdmin.rpc("get_user_org_id", { _user_id: userId });
      if (!orgId) {
        return new Response(JSON.stringify({ error: "Organización no encontrada" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: orgProfiles, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("organization_id", orgId);
      if (profErr) {
        throw new Error(`No se pudieron listar perfiles: ${profErr.message}`);
      }
      const orgUserIds = new Set((orgProfiles ?? []).map((p: any) => p.user_id));

      const { data: tokenRows, error: tokensErr } = await supabaseAdmin
        .from("microsoft_tokens")
        .select("*");
      if (tokensErr) {
        throw new Error(`No se pudieron listar tokens: ${tokensErr.message}`);
      }
      const targets = (tokenRows ?? []).filter((r: any) => orgUserIds.has(r.user_id));

      const report = {
        total: targets.length,
        synced: 0,
        no_photo: 0,
        failed: 0,
        errors: [] as { user_id: string; error: string }[],
      };

      for (const row of targets) {
        try {
          const at = await refreshTokenIfNeeded(supabaseAdmin, row.user_id, row);
          const res = await syncProfilePhotoFor(supabaseAdmin, row.user_id, at);
          if ("code" in res && res.code === "NO_PHOTO") report.no_photo += 1;
          else report.synced += 1;
        } catch (e) {
          report.failed += 1;
          report.errors.push({
            user_id: row.user_id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return new Response(JSON.stringify(report), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    let result;

    switch (action) {
      case "calendars": {
        // Lista los calendarios disponibles dentro de la cuenta M365 conectada
        // (calendario principal, calendarios adicionales y compartidos).
        const res = await graphMailFetchWithRetry(
          accessToken,
          `/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit,owner&$top=100`,
          {},
        );
        result = await res.json();
        break;
      }

      case "calendar-events": {
        const start = params?.start || new Date().toISOString();
        const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const qs = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100`;
        const prefHeaders = { headers: { Prefer: 'outlook.timezone="America/Mexico_City"' } };

        // Si el frontend pide calendarios específicos, consultamos cada uno y
        // fusionamos, etiquetando cada evento con su calendario de origen.
        const calendarIds: string[] = Array.isArray(params?.calendarIds)
          ? params.calendarIds.filter((id: unknown) => typeof id === "string" && id.length > 0)
          : [];

        if (calendarIds.length > 0) {
          const perCalendar = await Promise.all(
            calendarIds.map(async (calId: string) => {
              try {
                const r = await graphMailFetchWithRetry(
                  accessToken,
                  `/me/calendars/${encodeURIComponent(calId)}/calendarView?${qs}`,
                  prefHeaders,
                );
                const json = await r.json();
                const items = Array.isArray(json?.value) ? json.value : [];
                return items.map((ev: Record<string, unknown>) => ({ ...ev, calendarId: calId }));
              } catch (_) {
                return [];
              }
            }),
          );
          const merged = perCalendar.flat();
          merged.sort((a: any, b: any) => {
            const sa = a?.start?.dateTime || a?.start?.date || "";
            const sb = b?.start?.dateTime || b?.start?.date || "";
            return String(sa).localeCompare(String(sb));
          });
          result = { value: merged };
          break;
        }

        const res = await graphMailFetchWithRetry(
          accessToken,
          `/me/calendarview?${qs}`,
          prefHeaders,
        );
        result = await res.json();
        break;
      }

      case "create-event": {
        const rawEventPayload = params?.event ?? {};

        // Normalización defensiva contra ErrorPropertyValidationFailure
        const normalizeEventPayload = (ev: Record<string, any>): Record<string, any> => {
          const out: Record<string, any> = { ...ev };

          // 1. body.contentType: Graph espera "text" | "html" (normalizamos a minúsculas)
          if (out.body && typeof out.body === "object") {
            const ct = String(out.body.contentType || "").toLowerCase();
            out.body = {
              ...out.body,
              contentType: ct === "html" ? "html" : "text",
            };
            if (!out.body.content || String(out.body.content).trim() === "") {
              delete out.body;
            }
          }

          // 2. subject debe ser string
          if (out.subject != null) out.subject = String(out.subject);

          // 3. attendees: filtrar entradas vacías/mal formadas
          if (Array.isArray(out.attendees)) {
            out.attendees = out.attendees
              .map((a: any) => {
                const address = String(a?.emailAddress?.address || "").trim();
                if (!address) return null;
                return {
                  emailAddress: {
                    address,
                    ...(a?.emailAddress?.name ? { name: String(a.emailAddress.name) } : {}),
                  },
                  type: a?.type || "required",
                };
              })
              .filter(Boolean);
            if (out.attendees.length === 0) delete out.attendees;
          }

          // 4. categories: solo strings no vacíos
          if (Array.isArray(out.categories)) {
            out.categories = out.categories
              .map((c: any) => (typeof c === "string" ? c.trim() : ""))
              .filter(Boolean);
            if (out.categories.length === 0) delete out.categories;
          }

          // 5. location: asegurar que sólo lleve displayName si es objeto
          if (out.location && typeof out.location === "object") {
            const dn = String(out.location.displayName || "").trim();
            if (!dn) {
              delete out.location;
            } else {
              out.location = { displayName: dn };
            }
          }

          // 6. onlineMeetingProvider sólo si isOnlineMeeting
          if (!out.isOnlineMeeting) {
            delete out.onlineMeetingProvider;
            delete out.onlineMeeting;
            delete out.isOnlineMeeting;
          }

          // 7. Asegurar que start/end tengan timeZone (si no, defaulteamos a UTC)
          if (out.start && typeof out.start === "object" && !out.start.timeZone) {
            out.start = { ...out.start, timeZone: "UTC" };
          }
          if (out.end && typeof out.end === "object" && !out.end.timeZone) {
            out.end = { ...out.end, timeZone: "UTC" };
          }

          return out;
        };

        const eventPayload = normalizeEventPayload(rawEventPayload);
        const hasOnlineMeeting = !!eventPayload?.isOnlineMeeting;

        // Validate start < end before hitting Graph (saves a round-trip and gives a clearer error)
        const startDt = eventPayload.start?.dateTime as string | undefined;
        const endDt = eventPayload.end?.dateTime as string | undefined;
        if (startDt && endDt && endDt <= startDt) {
          result = {
            error: `La hora de fin (${endDt.slice(11, 16)}) debe ser después de la hora de inicio (${startDt.slice(11, 16)}). Si pusiste "12:00 a.m." asegúrate de seleccionar "p.m." para mediodía.`,
          };
          break;
        }

        const tryCreate = async (payload: Record<string, any>): Promise<Response> =>
          graphMailFetchWithRetry(accessToken, `/me/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

        try {
          const res = await tryCreate(eventPayload);
          result = await res.json();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isValidationFailure =
            /\[400\]/.test(msg) &&
            (msg.includes("ErrorPropertyValidationFailure") ||
              msg.toLowerCase().includes("at least one property failed validation") ||
              msg.toLowerCase().includes("onlinemeeting"));

          console.error("[microsoft-api] create-event failed", {
            graphError: msg,
            payloadKeys: Object.keys(eventPayload),
            payload: eventPayload,
          });

          if (!isValidationFailure) throw err;

          // Fallback progresivo: eliminar campos uno por uno para aislar el problema.
          // Orden: primero online meeting (si existía), luego campos opcionales,
          // finalmente dejar sólo lo esencial (subject, start, end).
          const attempts: Array<{ label: string; payload: Record<string, any> }> = [];

          if (hasOnlineMeeting) {
            const p = { ...eventPayload };
            delete p.isOnlineMeeting;
            delete p.onlineMeetingProvider;
            delete p.onlineMeeting;
            attempts.push({ label: "without-online-meeting", payload: p });
          }
          {
            const p = { ...eventPayload };
            delete p.isOnlineMeeting;
            delete p.onlineMeetingProvider;
            delete p.onlineMeeting;
            delete p.attendees;
            attempts.push({ label: "without-attendees-and-online", payload: p });
          }
          {
            const p = { ...eventPayload };
            delete p.isOnlineMeeting;
            delete p.onlineMeetingProvider;
            delete p.onlineMeeting;
            delete p.attendees;
            delete p.categories;
            attempts.push({ label: "without-attendees-categories-online", payload: p });
          }
          {
            const p: Record<string, any> = {
              subject: eventPayload.subject || "(sin título)",
              start: eventPayload.start,
              end: eventPayload.end,
            };
            if (eventPayload.isAllDay) p.isAllDay = true;
            attempts.push({ label: "minimal", payload: p });
          }

          let recovered: any = null;
          let recoveredLabel: string | null = null;
          let lastFallbackError = msg;
          for (const attempt of attempts) {
            try {
              console.warn(
                `[microsoft-api] retrying create-event with fallback: ${attempt.label}`,
                { payloadKeys: Object.keys(attempt.payload) },
              );
              const retryRes = await tryCreate(attempt.payload);
              recovered = await retryRes.json();
              recoveredLabel = attempt.label;
              break;
            } catch (e) {
              lastFallbackError = e instanceof Error ? e.message : String(e);
              console.warn(
                `[microsoft-api] fallback ${attempt.label} also failed`,
                { error: lastFallbackError },
              );
            }
          }

          if (!recovered) {
            // Ningún fallback funcionó: lanzamos error con diagnóstico útil.
            throw new Error(
              `Microsoft rechazó el evento. Error de Graph: ${msg}. Último intento (${attempts[attempts.length - 1]?.label}): ${lastFallbackError}`,
            );
          }

          result = {
            ...recovered,
            fallbackApplied: recoveredLabel,
            originalGraphError: msg,
            ...(recoveredLabel?.includes("online") ? { onlineMeetingFallback: true, onlineMeetingFallbackReason: msg } : {}),
          };
        }
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

      case "create-outlook-category": {
        const displayName = String(params?.displayName || "").trim();
        if (!displayName) throw new Error("displayName required");
        // Graph exige un color preset (preset0..preset24). Si el cliente no manda uno
        // válido, derivamos uno estable del nombre.
        let h = 0;
        for (let i = 0; i < displayName.length; i++) h = (h * 31 + displayName.charCodeAt(i)) >>> 0;
        const color = typeof params?.color === "string" && params.color.startsWith("preset")
          ? params.color
          : `preset${h % 25}`;
        const res = await graphMailFetchWithRetry(accessToken, `/me/outlook/masterCategories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName, color }),
        });
        result = await res.json();
        break;
      }

      case "delete-outlook-category": {
        const id = String(params?.id || "").trim();
        if (!id) throw new Error("id required");
        await graphMailFetchWithRetry(accessToken, `/me/outlook/masterCategories/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: {},
        });
        result = { success: true };
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
        // Sin `sensitivity`: el parser de Graph (RequestBroker--ParseUri) la rechaza de forma
        // intermitente en listados ("Could not find a property named 'sensitivity'"), incluso
        // sin $filter. El detalle del mensaje sí la trae (esa ruta no falla).
        const select =
          "$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,createdDateTime,isRead,hasAttachments,importance,conversationId";

        const rawSearch =
          typeof params?.search === "string" ? params.search.replace(/\s+/g, " ").trim() : "";
        if (rawSearch) {
          const forSearch = rawSearch
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .replace(/"/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (!forSearch) {
            result = { value: [] };
            break;
          }
          // Búsqueda en todo el buzón: los correos (p. ej. Microsoft Forms) a veces no están en la carpeta
          // visible, y con $search Graph no admite $orderby; combinarlo suele provocar 400.
          const searchParam = `&$search=${encodeURIComponent(`"${forSearch}"`)}`;
          result = await graphRequest(
            accessToken,
            `/me/messages?${select}&$top=${top}&$count=true${searchParam}`,
            { headers: GRAPH_MAIL_SEARCH_HEADERS },
          );
          break;
        }

        const skipParam = skip > 0 ? `&$skip=${skip}` : "";
        const filterUnread = params?.filterUnread === true;
        // Graph exige que la propiedad del $orderby aparezca PRIMERO en el $filter
        // (si no, responde 400 InefficientFilter). De ahí el receivedDateTime ge trivial.
        const filterParam = filterUnread
          ? "&$filter=receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false"
          : "";
        result = await graphRequest(
          accessToken,
          `/me/mailFolders/${folder}/messages?${select}&$top=${top}&$orderby=receivedDateTime desc&$count=true${skipParam}${filterParam}`,
          { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
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
        // Fetch root folders first (with $select so we get wellKnownFolderName + childFolderCount).
        const rootFolders = await listMailFoldersRootOnlyLegacy(accessToken) as Record<string, unknown>[];
        console.log(`[microsoft-api] mail-folders: root=${rootFolders.length}`);

        // Fetch children for every root folder that declares children, plus always inbox.
        // This handles users (like vturcott) whose custom folders live inside inbox or any other
        // root folder. We cap at 20 parent fetches to avoid timeouts.
        const childrenByParent = new Map<string, unknown[]>();

        /** Fetch all child folders for a given parent ID with two strategies (hidden / plain). */
        async function fetchChildFolders(parentId: string): Promise<unknown[]> {
          const strategies = [
            `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000&includeHiddenFolders=true`,
            `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000`,
          ];
          for (const firstPath of strategies) {
            try {
              const fetched: unknown[] = [];
              let path: string | null = firstPath;
              for (let page = 0; page < 10 && path; page++) {
                const data = (await graphRequest(accessToken, path)) as {
                  value?: unknown[];
                  "@odata.nextLink"?: string;
                };
                if (Array.isArray(data?.value)) for (const v of data.value) fetched.push(v);
                const nl = data?.["@odata.nextLink"];
                path = typeof nl === "string" && nl ? nextLinkToPath(nl) : null;
              }
              return fetched;
            } catch (e) {
              console.warn(`[microsoft-api] mail-folders: childFolders(${parentId}) strategy failed`, String(e).slice(0, 200));
            }
          }
          return [];
        }

        // System well-known folder names that we never need to expand — their children
        // (if any) are not custom user folders and would clutter the sidebar.
        const SYSTEM_WELL_KNOWN = new Set([
          "deleteditems", "sentitems", "junkemail", "outbox", "drafts",
          "archive", "msgfolderroot", "recoverableitemsdeletions",
          "conversationhistory", "scheduled",
        ]);

        // Identify which root folders to fetch children for.
        // Always include inbox (by wellKnownFolderName or alias), plus any non-system folder
        // that declares children. Skip system folders to avoid noise.
        const inboxFolder = rootFolders.find(
          (f) => String(f.wellKnownFolderName || "").toLowerCase() === "inbox"
        );

        const parentIdsToFetch = new Set<string>();

        // Add inbox by actual ID (preferred) or fall back to well-known alias.
        if (inboxFolder?.id && typeof inboxFolder.id === "string") {
          parentIdsToFetch.add(inboxFolder.id);
        } else {
          // Alias fallback — treated as a special marker below.
          parentIdsToFetch.add("__inbox_alias__");
        }

        // Add non-system root folders that have children.
        for (const f of rootFolders) {
          const id = typeof f.id === "string" ? f.id : null;
          if (!id) continue;
          const wk = String(f.wellKnownFolderName || "").toLowerCase();
          if (wk && SYSTEM_WELL_KNOWN.has(wk)) continue; // skip system folders
          const cc = typeof f.childFolderCount === "number" ? f.childFolderCount : -1;
          if (cc !== 0) parentIdsToFetch.add(id);
        }

        let parentFetchCount = 0;
        for (const parentId of parentIdsToFetch) {
          if (parentFetchCount >= 20) break;
          parentFetchCount++;
          const resolvedId = parentId === "__inbox_alias__" ? "inbox" : parentId;
          const children = await fetchChildFolders(resolvedId);
          if (children.length > 0) {
            childrenByParent.set(resolvedId, children);
            console.log(`[microsoft-api] mail-folders: children(${resolvedId})=${children.length}`);
          }
        }

        const allChildren = Array.from(childrenByParent.values()).flat();
        console.log(`[microsoft-api] mail-folders: total children=${allChildren.length}`);
        result = { folders: [...rootFolders, ...allChildren] };
        break;
      }

      case "child-folders": {
        const parentId = params?.parentId;
        if (!parentId || typeof parentId !== "string") {
          return new Response(JSON.stringify({ error: "parentId is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const all: unknown[] = [];
        let path = `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders?$select=${MAIL_FOLDER_LIST_SELECT}&$top=1000`;
        const maxPages = 10;
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
          const next = nextLinkToPath(nl);
          if (!next) break;
          path = next;
        }
        result = { folders: all };
        break;
      }

      case "email-conversation": {
        const convId = params?.conversationId;
        if (!convId) throw new Error("conversationId required");
        const odataSafe = String(convId).replace(/'/g, "''");
        const convSelect =
          "$select=id,conversationId,subject,bodyPreview,body,from,receivedDateTime,sentDateTime,createdDateTime,isRead,hasAttachments";
        const filter = encodeURIComponent(`conversationId eq '${odataSafe}'`);
        const data = await graphRequest(
          accessToken,
          `/me/messages?${convSelect}&$filter=${filter}&$orderby=receivedDateTime asc&$top=50`,
          { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
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
       * Firma para “Nuevo correo”.
       * Graph no expone el HTML de firma de Outlook/OWA; orden: Kawiil (DB) → inferida (Enviados) → /me
       */
      case "get-email-signature-html": {
        const escapeHtml = (s: string) =>
          s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const { data: profileRow, error: profileSigErr } = await supabaseAdmin
          .from("profiles")
          .select("outlook_signature_html")
          .eq("user_id", userId)
          .maybeSingle();
        if (!profileSigErr && profileRow) {
          const manual = String((profileRow as { outlook_signature_html?: string }).outlook_signature_html || "")
            .trim();
          if (manual) {
            result = { html: manual, source: "kawiil_profile" };
            break;
          }
        }

        const sentBodies = await fetchRecentSentMessageBodies(accessToken, 8);
        const inferred = inferSignatureFromSentBodies(sentBodies);
        if (inferred) {
          result = {
            html: inferred.html,
            source: "inferred_from_sent",
            confidence: inferred.confidence,
          };
          break;
        }

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

      case "flag-email": {
        const messageId = normalizeGraphMessageOrAttachmentId(params?.messageId);
        const flagStatus = params?.flagStatus ?? "flagged"; // "flagged" | "notFlagged"
        if (!messageId) throw new Error("messageId required");
        result = await graphRequest(accessToken, `/me/messages/${messageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...GRAPH_MAIL_PREFER_IMMUTABLE },
          body: JSON.stringify({ flag: { flagStatus } }),
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

      /**
       * Descarga la foto de perfil de Microsoft 365 (Graph /me/photo/$value),
       * la sube al bucket `avatars` (carpeta {userId}/) y guarda la URL en
       * profiles.avatar_url. Si el usuario no tiene foto en Microsoft, devuelve
       * { code: "NO_PHOTO" } sin tocar profiles.
       */
      case "sync-profile-photo": {
        result = await syncProfilePhotoFor(supabaseAdmin, userId, accessToken);
        break;
      }

      case "create-mail-folder": {
        const displayName = params?.displayName;
        if (!displayName) throw new Error("displayName required");
        const existing = await findRootMailFolderByDisplayName(accessToken, displayName);
        if (existing) {
          result = existing;
          break;
        }
        try {
          const res = await graphMailFetchWithRetry(accessToken, `/me/mailFolders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ displayName }),
          });
          result = await res.json();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const code = graphErrorCodeFromThrownMessage(msg);
          if (code === "ErrorFolderExists" || msg.includes("[409]")) {
            const again = await findRootMailFolderByDisplayName(accessToken, displayName);
            if (again) {
              result = again;
              break;
            }
          }
          throw e;
        }
        break;
      }

      case "create-mail-rule": {
        const { displayName, senderEmail, moveToFolderId, markAsRead } = params || {};
        if (!senderEmail) throw new Error("senderEmail required");
        const rule: Record<string, unknown> = {
          displayName: displayName || `Regla: ${senderEmail}`,
          sequence: 1,
          isEnabled: true,
          conditions: {
            fromAddresses: [{ emailAddress: { address: senderEmail } }],
          },
          actions: {
            ...(moveToFolderId ? { moveToFolder: moveToFolderId } : {}),
            ...(markAsRead ? { markAsRead: true } : {}),
          },
        };
        result = await graphRequest(accessToken, "/me/mailFolders/inbox/messageRules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule),
        });
        break;
      }

      case "list-mail-rules": {
        result = await graphRequest(accessToken, "/me/mailFolders/inbox/messageRules");
        break;
      }

      // Aplica una regla a los correos que YA están en la bandeja (las reglas de Outlook solo
      // aplican a mail nuevo). Mueve los mensajes del remitente a la carpeta indicada.
      case "apply-mail-rule": {
        const senderEmail = String(params?.senderEmail || "").trim().toLowerCase();
        const moveToFolderId = params?.moveToFolderId as string | undefined;
        const alsoMarkRead = params?.markAsRead === true;
        if (!senderEmail) throw new Error("senderEmail required");
        const filter = encodeURIComponent(`from/emailAddress/address eq '${senderEmail.replace(/'/g, "''")}'`);
        let moved = 0;
        let total = 0;
        const MAX_TOTAL = 500; // tope de seguridad
        // Repetir por lotes: al mover, los correos salen de la bandeja, así que siempre
        // pedimos el primer lote de los que quedan hasta que no haya más (o alcanzar el tope).
        for (let batch = 0; batch < 20; batch++) {
          const list = (await graphRequest(
            accessToken,
            `/me/mailFolders/inbox/messages?$filter=${filter}&$select=id,isRead&$top=50`,
            { headers: GRAPH_MAIL_PREFER_IMMUTABLE },
          )) as { value?: Array<{ id: string; isRead?: boolean }> };
          const items = list.value ?? [];
          if (items.length === 0) break;
          total += items.length;
          for (const m of items) {
            if (moved >= MAX_TOTAL) break;
            try {
              if (alsoMarkRead && m.isRead === false) {
                await graphRequest(accessToken, `/me/messages/${m.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ isRead: true }),
                });
              }
              if (moveToFolderId) {
                await graphRequest(accessToken, `/me/messages/${m.id}/move`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ destinationId: moveToFolderId }),
                });
              }
              moved++;
            } catch {
              /* seguir con el resto */
            }
          }
          // Si no hay carpeta destino (solo markAsRead), no salen de la bandeja → evitar bucle infinito.
          if (!moveToFolderId || moved >= MAX_TOTAL) break;
        }
        result = { moved, total };
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

    /**
     * Graph 404 / ErrorItemNotFound. Usamos HTTP 200 para que el cliente Supabase
     * reciba el JSON en `data`: con 4xx `invoke` deja `data` en null y solo
     * `error` (FunctionsHttpError), y el front no puede leer `code` → runtime / pantalla en blanco.
     */
    if (message.includes("[404]") || message.includes("ErrorItemNotFound")) {
      return new Response(JSON.stringify({
        error: "El elemento no fue encontrado. Es posible que haya sido eliminado o modificado. Recarga la vista para actualizar.",
        code: "ITEM_NOT_FOUND",
      }), {
        status: 200,
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
