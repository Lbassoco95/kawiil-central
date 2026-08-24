import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Download, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDownloadLeadEmailAttachment,
  useLeadEmailAttachments,
  type LeadEmailAttachment,
} from "@/hooks/useLeadEmailAttachments";
import { base64ToBlob } from "@/lib/outlookEmailMedia";
import { effectiveAttachmentMime } from "@/lib/attachmentPreviewKind";
import {
  AttachmentPreviewDialog,
  type PreviewableAttachment,
} from "@/components/shared/AttachmentPreviewDialog";

interface Props {
  emailLogId: string;
  /** Sólo consulta el buzón cuando el correo está abierto. */
  enabled: boolean;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Adjuntos del correo, listados desde el buzón, con vista previa y descarga.
 *
 * `email_log` sólo guarda la bandera `has_attachments`; los archivos viven en
 * Microsoft 365, así que se piden al abrir el correo y se traen uno a uno. El
 * archivo bajado se guarda en memoria mientras el correo sigue abierto, para
 * que revisar y luego descargar no vuelva a pegarle al buzón.
 */
export function LeadEmailAttachments({ emailLogId, enabled }: Props) {
  const { data: attachments = [], isLoading, error } = useLeadEmailAttachments(emailLogId, enabled);
  const download = useDownloadLeadEmailAttachment();
  const [preview, setPreview] = useState<PreviewableAttachment | null>(null);
  /** Adjunto que se está trayendo del buzón (para el spinner de esa fila). */
  const [busyId, setBusyId] = useState<string | null>(null);
  const cache = useRef(new Map<string, PreviewableAttachment>());

  const fetchAttachment = async (att: LeadEmailAttachment): Promise<PreviewableAttachment | null> => {
    const cached = cache.current.get(att.id);
    if (cached) return cached;
    setBusyId(att.id);
    try {
      const file = await download.mutateAsync({ emailLogId, attachmentId: att.id });
      const mime = effectiveAttachmentMime(file.name || att.name, file.contentType || att.contentType);
      const ready: PreviewableAttachment = {
        name: file.name || att.name,
        contentType: mime,
        blob: base64ToBlob(file.contentBytes, mime),
      };
      cache.current.set(att.id, ready);
      return ready;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el adjunto");
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const handlePreview = async (att: LeadEmailAttachment) => {
    const file = await fetchAttachment(att);
    if (file) setPreview(file);
  };

  const handleDownload = async (att: LeadEmailAttachment) => {
    const file = await fetchAttachment(att);
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // El navegador ya copió el blob; liberar la URL evita fugas de memoria.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  if (isLoading) {
    return (
      <p className="ml-6 mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Buscando adjuntos en el buzón…
      </p>
    );
  }

  if (error) {
    return (
      <p className="ml-6 mt-2 text-[11px] text-muted-foreground">
        No se pudieron leer los adjuntos: {error instanceof Error ? error.message : "error"}
      </p>
    );
  }

  if (attachments.length === 0) {
    return (
      <p className="ml-6 mt-2 text-[11px] text-muted-foreground">
        Sin adjuntos descargables (las imágenes de la firma no cuentan).
      </p>
    );
  }

  return (
    <div className="ml-6 mt-2 space-y-1">
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Paperclip className="h-3 w-3" />
        {attachments.length} adjunto{attachments.length === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {attachments.map((att) => {
          const busy = busyId === att.id;
          const blocked = !att.downloadable || busyId !== null;
          return (
            <div
              key={att.id}
              className="flex max-w-full items-center overflow-hidden rounded-md border bg-background"
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                disabled={blocked}
                onClick={() => void handlePreview(att)}
                title={att.downloadable ? `Ver ${att.name}` : "Este adjunto no es un archivo"}
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                ) : (
                  <Eye className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{att.name}</span>
                {att.size ? (
                  <span className="shrink-0 text-muted-foreground">{formatSize(att.size)}</span>
                ) : null}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto shrink-0 rounded-none border-l px-2 py-1.5"
                disabled={blocked}
                onClick={() => void handleDownload(att)}
                title={att.downloadable ? `Descargar ${att.name}` : "Este adjunto no es un archivo"}
              >
                <Download className="h-3 w-3" />
                <span className="sr-only">Descargar {att.name}</span>
              </Button>
            </div>
          );
        })}
      </div>

      <AttachmentPreviewDialog attachment={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
