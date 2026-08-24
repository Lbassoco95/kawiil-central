import { Button } from "@/components/ui/button";
import { Paperclip, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDownloadLeadEmailAttachment,
  useLeadEmailAttachments,
  type LeadEmailAttachment,
} from "@/hooks/usePipeline";
import { base64ToBlobUrl } from "@/lib/outlookEmailMedia";

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
 * Adjuntos del correo, listados desde el buzón y descargables.
 *
 * `email_log` sólo guarda la bandera `has_attachments`; los archivos viven en
 * Microsoft 365, así que se piden al abrir el correo y se descargan uno a uno.
 */
export function LeadEmailAttachments({ emailLogId, enabled }: Props) {
  const { data: attachments = [], isLoading, error } = useLeadEmailAttachments(emailLogId, enabled);
  const download = useDownloadLeadEmailAttachment();

  const handleDownload = (att: LeadEmailAttachment) => {
    download.mutate(
      { emailLogId, attachmentId: att.id },
      {
        onSuccess: (file) => {
          const url = base64ToBlobUrl(file.contentBytes, file.contentType);
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          // El navegador ya copió el blob; liberar la URL evita fugas de memoria.
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        },
        onError: (e: Error) => toast.error(e.message || "No se pudo descargar el adjunto"),
      },
    );
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
        {attachments.map((att) => (
          <Button
            key={att.id}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 max-w-full gap-1.5 px-2 text-xs"
            disabled={!att.downloadable || download.isPending}
            onClick={() => handleDownload(att)}
            title={att.downloadable ? `Descargar ${att.name}` : "Este adjunto no es un archivo"}
          >
            <Download className="h-3 w-3 shrink-0" />
            <span className="truncate">{att.name}</span>
            {att.size ? (
              <span className="shrink-0 text-muted-foreground">{formatSize(att.size)}</span>
            ) : null}
          </Button>
        ))}
      </div>
    </div>
  );
}
