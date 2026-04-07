import { supabase } from "@/integrations/supabase/client";

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

export function base64ToBlobUrl(contentBytes: string, contentType: string): string {
  const byteChars = atob(contentBytes);
  const byteNums = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteNums], { type: contentType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}

export async function fetchMessageAttachmentContent(messageId: string, attachmentId: string) {
  const { data, error } = await supabase.functions.invoke("microsoft-api", {
    body: { action: "message-attachment-content", params: { messageId, attachmentId } },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as {
    contentBytes: string;
    contentType: string;
    name: string;
    size?: number;
  };
}
