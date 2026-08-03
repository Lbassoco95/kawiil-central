import { useEffect, useMemo, useState } from "react";
import {
  extractCidRefsFromHtml,
  findAttachmentForCid,
  replaceCidInHtml,
  inferMimeFromFileName,
  type OutlookAttachment,
} from "@/lib/outlookEmailMedia";
import { fetchRoutedAttachmentBlob } from "@/hooks/useLinkedAccounts";

const MAX_INLINE_BYTES = 4 * 1024 * 1024;

/** Blob → base64 por chunks (evita stack overflow con binarios grandes). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Sustituye referencias cid: del HTML por data URLs (contenido del adjunto vía Graph).
 */
export function useResolvedEmailHtml(
  messageId: string | undefined,
  html: string | undefined,
  attachments: OutlookAttachment[] | undefined,
) {
  const [resolved, setResolved] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const attSig = useMemo(
    () => (attachments ?? []).map((a) => `${a.id}:${a.contentId ?? ""}`).join("|"),
    [attachments],
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!html?.trim()) {
        setResolved("");
        return;
      }
      if (!messageId) {
        setResolved(html);
        return;
      }
      const cids = extractCidRefsFromHtml(html);
      if (cids.length === 0) {
        setResolved(html);
        return;
      }

      setLoading(true);
      try {
        let out = html;
        for (const cid of cids) {
          if (cancelled) return;
          const att = findAttachmentForCid(attachments, cid);
          if (!att?.id) continue;
          try {
            // Enrutado por cuenta (principal / Outlook vinculada / Gmail) para que las imágenes
            // inline se vean también en correos de cuentas vinculadas, no solo la principal.
            const r = await fetchRoutedAttachmentBlob(messageId, {
              id: att.id,
              name: att.name || "",
              contentType: att.contentType || "",
              size: att.size ?? 0,
              contentId: att.contentId,
              isInline: att.isInline,
              "@odata.type": att["@odata.type"],
            });
            if (cancelled) return;
            if (r.blob.size > MAX_INLINE_BYTES) continue;
            const raw = (r.contentType || "").toLowerCase();
            const ct =
              raw && raw !== "application/octet-stream"
                ? r.contentType
                : inferMimeFromFileName(att.name || r.name || "") || att.contentType || "application/octet-stream";
            const b64 = await blobToBase64(r.blob);
            const dataUrl = `data:${ct};base64,${b64}`;
            out = replaceCidInHtml(out, cid, dataUrl);
          } catch {
            /* adjunto no descargable o tipo no soportado */
          }
        }
        if (!cancelled) setResolved(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [messageId, html, attSig, attachments]);

  const hasCids = !!(html && extractCidRefsFromHtml(html).length > 0);
  const displayHtml = resolved || html || "";
  return { html: displayHtml, loading: loading && hasCids && !!messageId };
}
