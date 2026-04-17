import {
  ACTIVE_SUPABASE_PUBLISHABLE_KEY,
  ACTIVE_SUPABASE_URL,
  supabase,
} from "@/integrations/supabase/client";

const SUPABASE_URL = ACTIVE_SUPABASE_URL;
const SUPABASE_ANON = ACTIVE_SUPABASE_PUBLISHABLE_KEY;

type AttachmentPayload = {
  contentBytes: string;
  contentType: string;
  name: string;
  size?: number;
};

/** Misma estrategia por chunks que la edge (evita stack con binarios grandes). */
function uint8ArrayToBase64Client(bytes: Uint8Array): string {
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function messageForMicrosoftParsedError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || parsed === null) return null;
  if ("code" in parsed && String((parsed as { code: unknown }).code) === "ITEM_NOT_FOUND") {
    return "El mensaje o el adjunto ya no coinciden con Microsoft (IDs desactualizados o elemento movido). Vuelve a la lista y abre el correo de nuevo.";
  }
  if ("error" in parsed) {
    return String((parsed as { error: unknown }).error);
  }
  return null;
}

/** Lanza si el JSON de microsoft-api es un error conocido (incl. NOT_CONNECTED, ITEM_NOT_FOUND). */
function throwIfMicrosoftJsonIsError(parsed: unknown): void {
  const msg = messageForMicrosoftParsedError(parsed);
  if (msg) throw new Error(msg);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Último recurso: JSON en trozos (Graph Range 206 o primer trozo con stream). */
async function fetchMessageAttachmentBlobViaChunks(
  postMicrosoftApi: (payload: object) => Promise<Response>,
  messageId: string,
  attachmentId: string,
): Promise<{ blob: Blob; name: string; contentType: string }> {
  const maxLen = 196608;
  let byteStart = 0;
  const acc: Uint8Array[] = [];
  let name = "adjunto";
  let contentType = "application/octet-stream";
  let totalSize: number | null = null;

  for (let guard = 0; guard < 400; guard++) {
    const res = await postMicrosoftApi({
      action: "message-attachment-chunk",
      params: { messageId, attachmentId, byteStart, maxLength: maxLen },
    });
    const text = await res.text();
    const trimmed = text.trim();
    let parsed: unknown = null;
    if (trimmed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error(`Trozo de adjunto inválido (${res.status}). ${trimmed.slice(0, 120)}`);
      }
    }
    if (!res.ok) {
      throw new Error(
        messageForMicrosoftParsedError(parsed) ??
          (trimmed.slice(0, 400) || `Error HTTP ${res.status}`),
      );
    }
    if (!trimmed) {
      throw new Error(
        "microsoft-api devolvió cuerpo vacío al pedir trozos. Despliega la función: supabase functions deploy microsoft-api --no-verify-jwt",
      );
    }
    throwIfMicrosoftJsonIsError(parsed);
    if (!parsed || typeof parsed !== "object" || parsed === null) {
      throw new Error(`Trozo de adjunto: JSON inválido (${res.status}). ${trimmed.slice(0, 180)}`);
    }
    const rec = parsed as Record<string, unknown>;
    if (!("partBase64" in rec)) {
      throw new Error(
        `microsoft-api no incluye partBase64 (¿versión antigua?). Despliega: supabase functions deploy microsoft-api --no-verify-jwt — detalle: ${trimmed.slice(0, 160)}`,
      );
    }
    const p = parsed as {
      partBase64: string | null;
      length: number;
      done: boolean;
      name?: string;
      contentType?: string;
      totalSize?: number | null;
    };
    name = String(p.name ?? name);
    contentType = String(p.contentType ?? contentType);
    if (typeof p.totalSize === "number") totalSize = p.totalSize;

    const raw = p.partBase64;
    if (raw == null || (typeof raw === "string" && raw.length === 0)) {
      if (p.done || byteStart > 0) break;
      throw new Error("Primer trozo del adjunto vacío.");
    }
    const bytes = base64ToUint8Array(raw);
    acc.push(bytes);
    const partLen = typeof p.length === "number" && p.length >= 0 ? p.length : bytes.length;
    byteStart += partLen;
    if (p.done) break;
    if (totalSize != null && byteStart >= totalSize) break;
    if (partLen === 0) break;
  }

  if (acc.length === 0) {
    throw new Error("No se recibieron datos del adjunto por trozos.");
  }

  const merged = concatUint8Arrays(acc);
  return {
    blob: new Blob([merged], { type: contentType }),
    name,
    contentType,
  };
}

function jsonAttachmentPayloadToBlob(parsed: unknown): { blob: Blob; name: string; contentType: string } | null {
  if (!parsed || typeof parsed !== "object" || parsed === null) return null;
  const cb = (parsed as { contentBytes?: unknown }).contentBytes;
  if (typeof cb !== "string" || cb.length === 0) return null;
  const name = String((parsed as { name?: unknown }).name ?? "adjunto");
  const rawCt = String((parsed as { contentType?: unknown }).contentType ?? "application/octet-stream");
  const inferred = inferMimeFromFileName(name);
  const mime =
    rawCt && rawCt.toLowerCase() !== "application/octet-stream" ? rawCt : inferred || rawCt;
  try {
    const byteChars = atob(cb);
    const byteNums = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
    return { blob: new Blob([byteNums], { type: mime }), name, contentType: mime };
  } catch {
    return null;
  }
}

/**
 * El gateway de Supabase a veces pone Content-Type: application/json aunque el cuerpo sea un PDF.
 * Miramos el primer byte real: `{` → JSON de la API; cualquier otra cosa → binario.
 */
async function responseBodyLooksLikeJsonObject(res: Response): Promise<boolean> {
  try {
    if (!res.body) return true;
    const reader = res.clone().body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 16) {
      const { value, done } = await reader.read();
      if (done || !value?.length) break;
      chunks.push(value);
      total += value.length;
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    if (chunks.length === 0) return true;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    let i = 0;
    if (merged.length >= 3 && merged[0] === 0xef && merged[1] === 0xbb && merged[2] === 0xbf) {
      i = 3;
    }
    while (i < merged.length && [0x20, 0x09, 0x0a, 0x0d].includes(merged[i])) {
      i++;
    }
    return i < merged.length && merged[i] === 0x7b;
  } catch {
    return true;
  }
}

/** Metadatos de adjunto devueltos por Graph (lista de mensaje). */
export type OutlookAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentId?: string;
  isInline?: boolean;
  "@odata.type"?: string;
};

export function normalizeCid(s: string): string {
  return s.replace(/^cid:/gi, "").replace(/[<>]/g, "").trim().toLowerCase();
}

export function extractCidRefsFromHtml(html: string): string[] {
  const set = new Set<string>();
  const re1 = /src\s*=\s*["']cid:([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html)) !== null) set.add(m[1]);

  const re2 = /url\s*\(\s*["']?cid:([^"')]+)["']?\s*\)/gi;
  while ((m = re2.exec(html)) !== null) set.add(m[1]);

  return [...set];
}

export function findAttachmentForCid(
  attachments: OutlookAttachment[] | undefined,
  cidRef: string,
): OutlookAttachment | undefined {
  if (!attachments?.length) return undefined;
  const n = normalizeCid(cidRef);
  return attachments.find((a) => {
    const t = a["@odata.type"] || "";
    if (t.includes("itemAttachment") || t.includes("referenceAttachment")) return false;
    const cid = a.contentId;
    if (cid) {
      const nc = normalizeCid(cid);
      if (nc === n || nc.includes(n) || n.includes(nc)) return true;
    }
    const name = (a.name || "").trim();
    if (name && normalizeCid(name) === n) return true;
    return false;
  });
}

/** Escapa caracteres especiales de cid para uso en RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceCidInHtml(html: string, cidRaw: string, replacementUrl: string): string {
  const escaped = escapeRegExp(cidRaw);
  let out = html.replace(new RegExp(`src\\s*=\\s*(["'])cid:${escaped}\\1`, "gi"), (_m, q: string) => `src=${q}${replacementUrl}${q}`);
  out = out.replace(new RegExp(`url\\(\\s*["']?cid:${escaped}["']?\\s*\\)`, "gi"), () => `url(${replacementUrl})`);
  return out;
}

/** Outlook a veces envía image/jpeg como application/octet-stream. */
export function inferMimeFromFileName(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (/\.(jpe?g)$/i.test(n)) return "image/jpeg";
  if (/\.png$/i.test(n)) return "image/png";
  if (/\.gif$/i.test(n)) return "image/gif";
  if (/\.webp$/i.test(n)) return "image/webp";
  if (/\.bmp$/i.test(n)) return "image/bmp";
  if (/\.(tiff?)$/i.test(n)) return "image/tiff";
  if (/\.pdf$/i.test(n)) return "application/pdf";
  if (/\.docx$/i.test(n)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (/\.xlsx$/i.test(n)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (/\.xlsm$/i.test(n)) {
    return "application/vnd.ms-excel.sheet.macroEnabled.12";
  }
  if (/\.xls$/i.test(n)) return "application/vnd.ms-excel";
  if (/\.csv$/i.test(n)) return "text/csv";
  if (/\.tsv$/i.test(n)) return "text/tab-separated-values";
  return null;
}

export function base64ToBlobUrl(contentBytes: string, contentType: string): string {
  const byteChars = atob(contentBytes);
  const byteNums = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteNums], { type: contentType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}

/**
 * Descarga el adjunto como Blob.
 * 1) `message-attachment-binary` (stream / binario).
 * 2) JSON `message-attachment-content` si cabe.
 * 3) `message-attachment-chunk` (trozos + Range en Graph) si el JSON se trunca.
 */
export async function fetchMessageAttachmentBlob(
  messageId: string,
  attachmentId: string,
): Promise<{ blob: Blob; name: string; contentType: string }> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Sesión no disponible para cargar adjuntos.");
  }

  const postMicrosoftApi = (payload: object) =>
    fetch(`${SUPABASE_URL}/functions/v1/microsoft-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify(payload),
    });

  const resBinary = await postMicrosoftApi({
    action: "message-attachment-binary",
    params: { messageId, attachmentId },
  });

  if (resBinary.ok) {
    const looksJson = await responseBodyLooksLikeJsonObject(resBinary);
    if (!looksJson) {
      const nameEnc = resBinary.headers.get("x-kawiil-attachment-name");
      const ctBinary = resBinary.headers.get("content-type") || "application/octet-stream";
      const blob = await resBinary.blob();
      if (blob.size === 0) {
        throw new Error("El adjunto llegó vacío. Vuelve a abrir el correo.");
      }
      return {
        blob,
        name: nameEnc ? decodeURIComponent(nameEnc) : "adjunto",
        contentType: ctBinary.split(";")[0].trim() || "application/octet-stream",
      };
    }
  }

  const textBinary = await resBinary.text();
  const trimmedBinary = textBinary.trim();
  let parsedBinary: unknown = null;
  if (trimmedBinary) {
    try {
      parsedBinary = JSON.parse(trimmedBinary);
    } catch {
      if (!resBinary.ok) {
        throw new Error(trimmedBinary.slice(0, 400) || `Error HTTP ${resBinary.status}`);
      }
    }
  }

  if (!resBinary.ok) {
    throw new Error(
      messageForMicrosoftParsedError(parsedBinary) ??
        (trimmedBinary.slice(0, 400) || `Error HTTP ${resBinary.status}`),
    );
  }

  throwIfMicrosoftJsonIsError(parsedBinary);
  const fromBinaryJson = jsonAttachmentPayloadToBlob(parsedBinary);
  if (fromBinaryJson) return fromBinaryJson;

  const resJson = await postMicrosoftApi({
    action: "message-attachment-content",
    params: { messageId, attachmentId },
  });
  const textJson = await resJson.text();
  const trimmedJson = textJson.trim();
  let parsedJson: unknown = null;
  if (trimmedJson) {
    try {
      parsedJson = JSON.parse(trimmedJson);
    } catch {
      throw new Error(`Respuesta inválida (${resJson.status}). ${trimmedJson.slice(0, 160)}`);
    }
  }

  if (!resJson.ok) {
    throw new Error(
      messageForMicrosoftParsedError(parsedJson) ??
        (trimmedJson.slice(0, 400) || `Error HTTP ${resJson.status}`),
    );
  }

  throwIfMicrosoftJsonIsError(parsedJson);
  const fromLegacy = jsonAttachmentPayloadToBlob(parsedJson);
  if (fromLegacy) return fromLegacy;

  return fetchMessageAttachmentBlobViaChunks(postMicrosoftApi, messageId, attachmentId);
}

/**
 * Igual que fetchMessageAttachmentBlob pero devuelve base64 (p. ej. cid en HTML).
 * Para tarjetas de adjunto usa fetchMessageAttachmentBlob y Object URL.
 */
export async function fetchMessageAttachmentContent(messageId: string, attachmentId: string): Promise<AttachmentPayload> {
  const { blob, name, contentType } = await fetchMessageAttachmentBlob(messageId, attachmentId);
  const buf = await blob.arrayBuffer();
  const contentBytes = uint8ArrayToBase64Client(new Uint8Array(buf));
  return {
    contentBytes,
    contentType,
    name,
    size: blob.size,
  };
}
