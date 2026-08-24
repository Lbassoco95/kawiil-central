import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Loader2 } from "lucide-react";
import {
  attachmentPreviewKind,
  attachmentPreviewKindLabel,
  type AttachmentPreviewKind,
} from "@/lib/attachmentPreviewKind";
import {
  buildEmailSheetPreview,
  EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES,
  type EmailSheetPreviewData,
} from "@/lib/emailAttachmentSheetPreview";

/** Adjunto ya descargado en memoria, listo para revisarse antes de guardarlo. */
export interface PreviewableAttachment {
  name: string;
  contentType?: string | null;
  blob: Blob;
}

interface Props {
  attachment: PreviewableAttachment | null;
  onClose: () => void;
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function tooBigMessage(kind: AttachmentPreviewKind): string {
  const app = kind === "docx" ? "Word" : kind === "sheet" ? "Excel" : "tu equipo";
  return `El archivo supera el límite de vista previa (20 MB). Descárgalo para abrirlo en ${app}.`;
}

/**
 * Vista previa de un adjunto sin salir de Kawiil.
 *
 * Recibe el archivo ya en memoria (`Blob`) y elige el visor según su tipo:
 * imagen y PDF nativos del navegador, DOCX vía Mammoth, hojas de cálculo y
 * CSV vía SheetJS, texto plano tal cual. Lo que no se puede pintar se ofrece
 * para descargar.
 */
export function AttachmentPreviewDialog({ attachment, onClose }: Props) {
  const name = attachment?.name || "adjunto";
  const kind = useMemo(
    () => (attachment ? attachmentPreviewKind(name, attachment.contentType) : "other"),
    [attachment, name],
  );

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [sheet, setSheet] = useState<EmailSheetPreviewData | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL de objeto para imagen y PDF; se libera al cerrar o cambiar de adjunto.
  useEffect(() => {
    if (!attachment || (kind !== "image" && kind !== "pdf")) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(attachment.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment, kind]);

  useEffect(() => {
    setDocxHtml(null);
    setSheet(null);
    setText(null);
    setError(null);
    setLoading(false);

    if (!attachment) return;
    if (kind !== "docx" && kind !== "sheet" && kind !== "text") return;

    if (attachment.blob.size > EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES) {
      setError(tooBigMessage(kind));
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        if (kind === "docx") {
          const mammoth = await import("mammoth");
          const arrayBuffer = await attachment.blob.arrayBuffer();
          const { value } = await mammoth.convertToHtml({ arrayBuffer });
          if (!cancelled) setDocxHtml(DOMPurify.sanitize(value, { USE_PROFILES: { html: true } }));
        } else if (kind === "sheet") {
          const data = await buildEmailSheetPreview(attachment.blob, name);
          if (!cancelled) setSheet(data);
        } else {
          const raw = await attachment.blob.text();
          if (!cancelled) setText(raw);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "No se pudo generar la vista previa.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachment, kind, name]);

  const handleDownload = () => {
    if (!attachment) return;
    const url = URL.createObjectURL(attachment.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name.trim() || "adjunto";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // El navegador ya copió el blob; liberar la URL evita fugas de memoria.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <Dialog open={!!attachment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0 space-y-2">
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle className="min-w-0 flex-1 truncate" title={name}>
              {name}
            </DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1"
              onClick={handleDownload}
              disabled={!attachment}
            >
              <Download className="h-4 w-4" />
              Descargar
            </Button>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wide">
              {attachmentPreviewKindLabel(kind)}
            </Badge>
            {attachment ? (
              <span className="text-muted-foreground">{formatSize(attachment.blob.size)}</span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/20">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
              Preparando vista previa…
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={handleDownload}>
                <Download className="mr-1 h-4 w-4" />
                Descargar
              </Button>
            </div>
          )}

          {!loading && !error && kind === "image" && objectUrl && (
            <div className="flex justify-center p-3">
              <img src={objectUrl} alt={name} className="h-auto max-w-full rounded-md border" />
            </div>
          )}

          {!loading && !error && kind === "pdf" && objectUrl && (
            <iframe
              src={`${objectUrl}#toolbar=1&navpanes=0`}
              title={name}
              className="min-h-[70vh] w-full rounded-md border-0 bg-background"
            />
          )}

          {!loading && !error && kind === "docx" && docxHtml && (
            <div
              className="prose prose-sm max-w-none p-4 text-foreground dark:prose-invert [&_p]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5"
              dangerouslySetInnerHTML={{ __html: docxHtml }}
            />
          )}

          {!loading && !error && kind === "docx" && !docxHtml && (
            <p className="p-4 text-sm text-muted-foreground">Sin contenido para mostrar.</p>
          )}

          {!loading && !error && kind === "sheet" && sheet && (
            <div className="flex min-h-0 flex-col">
              <p className="shrink-0 border-b border-border/50 px-4 pb-2 pt-3 text-xs text-muted-foreground">
                Hoja «{sheet.sheetName}»
                {sheet.extraSheets > 0
                  ? ` · ${sheet.extraSheets} hoja(s) más en el archivo (sólo se muestra la primera)`
                  : ""}
                {sheet.truncatedRows || sheet.truncatedCols
                  ? " · Vista truncada (filas/columnas). Descarga el archivo para ver todo."
                  : ""}
              </p>
              <div className="overflow-auto px-2 pb-3">
                {sheet.rows.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Sin filas de datos.</p>
                ) : (
                  <table className="w-max min-w-full border-collapse text-xs">
                    <tbody>
                      {sheet.rows.map((row, i) => (
                        <tr
                          key={i}
                          className={
                            i === 0 ? "bg-muted/70 font-medium" : i % 2 === 0 ? "bg-background" : "bg-muted/20"
                          }
                        >
                          {row.map((cell, j) => (
                            <td
                              key={j}
                              className="max-w-[220px] truncate whitespace-nowrap border border-border px-2 py-1 align-top"
                              title={cell}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {!loading && !error && kind === "text" && text != null && (
            <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs text-foreground">{text}</pre>
          )}

          {!loading && !error && kind === "other" && (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <p className="font-medium text-foreground">Vista previa no disponible</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Este tipo de archivo no se puede mostrar en el navegador. Descárgalo para abrirlo en tu equipo.
                </p>
              </div>
              <Button type="button" size="sm" onClick={handleDownload}>
                <Download className="mr-1 h-4 w-4" />
                Descargar archivo
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
