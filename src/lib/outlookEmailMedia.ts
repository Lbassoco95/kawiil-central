import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function readFunctionsHttpErrorBody(error: unknown): Promise<string> {
  if (!error || typeof error !== "object") return "";
  const e = error as Record<string, unknown>;
  const resp = e.context ?? e.response;
  if (resp instanceof Response) {
    try {
      return await resp.clone().text();
    } catch {
      return "";
    }
  }
  return "";
}

type AttachmentPayload = {
  contentBytes: string;
  contentType: string;
  name: string;
  size?: number;
};

function hasContentBytes(data: unknown): data is AttachmentPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as AttachmentPayload).contentBytes === "string" &&
    (data as AttachmentPayload).contentBytes.length > 0
  );
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
 * Descarga bytes del adjunto vía microsoft-api (siempre binario Graph /$value en el servidor).
 */
export async function fetchMessageAttachmentContent(messageId: string, attachmentId: string): Promise<AttachmentPayload> {
  const body = { action: "message-attachment-content", params: { messageId, attachmentId } };

  let { data, error } = await supabase.functions.invoke("microsoft-api", { body });

  if (!hasContentBytes(data)) {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (token && SUPABASE_URL && SUPABASE_ANON) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/microsoft-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON,
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      if (res.ok && hasContentBytes(json)) {
        data = json;
        error = null;
      }
    }
  }

  if (hasContentBytes(data)) {
    return data;
  }

  const extra = await readFunctionsHttpErrorBody(error);
  const hint = [extra, typeof data === "object" && data && "error" in data ? String((data as { error: unknown }).error) : "", error instanceof Error ? error.message : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);

  throw new Error(
    hint || "No se pudo cargar el adjunto. Comprueba la conexión con Microsoft y que la función microsoft-api esté desplegada.",
  );
}
