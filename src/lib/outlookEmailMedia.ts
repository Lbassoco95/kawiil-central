import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

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

async function parseMicrosoftApiErrorResponse(res: Response): Promise<string> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return `Error HTTP ${res.status}`;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && parsed !== null && "code" in parsed) {
      const code = String((parsed as { code: unknown }).code);
      if (code === "ITEM_NOT_FOUND") {
        return "El mensaje o el adjunto ya no coinciden con Microsoft (IDs desactualizados o elemento movido). Vuelve a la lista y abre el correo de nuevo.";
      }
    }
    if (parsed && typeof parsed === "object" && parsed !== null && "error" in parsed) {
      return String((parsed as { error: unknown }).error);
    }
  } catch {
    return trimmed.slice(0, 400);
  }
  return trimmed.slice(0, 400);
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
 * Descarga el adjunto como Blob (cuerpo binario desde microsoft-api, sin JSON/base64).
 * Evita límites de tamaño que dejaban el cuerpo vacío en previsualizaciones de PDF.
 */
export async function fetchMessageAttachmentBlob(
  messageId: string,
  attachmentId: string,
): Promise<{ blob: Blob; name: string; contentType: string }> {
  const body = { action: "message-attachment-binary", params: { messageId, attachmentId } };

  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token || !SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Sesión no disponible para cargar adjuntos.");
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/microsoft-api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(await parseMicrosoftApiErrorResponse(res));
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const errText = await res.text();
    const trimmed = errText.trim();
    let parsed: unknown = null;
    if (trimmed) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error(`Respuesta inválida (${res.status}). ${trimmed.slice(0, 160)}`);
      }
    }
    if (parsed && typeof parsed === "object" && parsed !== null && "error" in parsed) {
      throw new Error(String((parsed as { error: unknown }).error));
    }
    throw new Error(
      "La función devolvió JSON en lugar del archivo. Despliega la última versión de microsoft-api (message-attachment-binary).",
    );
  }

  const nameEnc = res.headers.get("x-kawiil-attachment-name");
  const blob = await res.blob();
  if (blob.size === 0) {
    throw new Error(
      "El adjunto llegó vacío. Si persiste, despliega microsoft-api y vuelve a abrir el correo.",
    );
  }

  return {
    blob,
    name: nameEnc ? decodeURIComponent(nameEnc) : "adjunto",
    contentType: ct.split(";")[0].trim() || "application/octet-stream",
  };
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
