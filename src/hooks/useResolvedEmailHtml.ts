import { useEffect, useMemo, useState } from "react";
import {
  extractCidRefsFromHtml,
  findAttachmentForCid,
  replaceCidInHtml,
  fetchMessageAttachmentContent,
  inferMimeFromFileName,
  type OutlookAttachment,
} from "@/lib/outlookEmailMedia";

const MAX_INLINE_BYTES = 4 * 1024 * 1024;

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
            const r = await fetchMessageAttachmentContent(messageId, att.id);
            if (cancelled) return;
            const approxBytes = Math.floor((r.contentBytes?.length || 0) * 0.75);
            if (approxBytes > MAX_INLINE_BYTES) continue;
            const raw = (r.contentType || "").toLowerCase();
            const ct =
              raw && raw !== "application/octet-stream"
                ? r.contentType!
                : inferMimeFromFileName(att.name || r.name || "") || att.contentType || "application/octet-stream";
            const dataUrl = `data:${ct};base64,${r.contentBytes}`;
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
