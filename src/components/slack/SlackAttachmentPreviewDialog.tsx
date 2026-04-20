import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Music2,
} from "lucide-react";
import { toast } from "sonner";
import { fetchSlackPrivateFileBlob, type SlackFile } from "@/lib/slackApi";
import { cn } from "@/lib/utils";

type PreviewKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "text"
  | "office"
  | "unknown";

type Props = {
  file: SlackFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function fileExt(name?: string): string {
  if (!name) return "";
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function detectKind(file: SlackFile): PreviewKind {
  const mime = file.mimetype || "";
  const ext = (file.filetype || fileExt(file.name) || "").toLowerCase();
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "aac", "flac"].includes(ext)) return "audio";
  if (
    mime === "text/plain" ||
    mime === "text/csv" ||
    mime === "text/markdown" ||
    mime.includes("xml") ||
    ["txt", "csv", "md", "log", "xml", "json"].includes(ext)
  ) {
    return "text";
  }
  if (
    ["xlsx", "xls", "docx", "doc", "pptx", "ppt"].includes(ext) ||
    mime.includes("spreadsheet") ||
    mime.includes("wordprocessing") ||
    mime.includes("presentation") ||
    mime.includes("officedocument")
  ) {
    return "office";
  }
  return "unknown";
}

function kindLabel(kind: PreviewKind): string {
  switch (kind) {
    case "image":
      return "Imagen";
    case "pdf":
      return "PDF";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "text":
      return "Texto";
    case "office":
      return "Office";
    default:
      return "Archivo";
  }
}

function KindIcon({ kind, className }: { kind: PreviewKind; className?: string }) {
  switch (kind) {
    case "image":
      return <ImageIcon className={className} />;
    case "pdf":
      return <FileText className={className} />;
    case "video":
      return <Film className={className} />;
    case "audio":
      return <Music2 className={className} />;
    case "office":
      return <FileSpreadsheet className={className} />;
    default:
      return <FileText className={className} />;
  }
}

function formatSize(size?: number): string {
  if (!size || !Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SlackAttachmentPreviewDialog({ file, open, onOpenChange }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const kind: PreviewKind = file ? detectKind(file) : "unknown";
  const label = file?.title || file?.name || "Archivo";
  const sizeLabel = formatSize(file?.size);
  const privateUrl = file?.url_private_download || file?.url_private || "";

  const revoke = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;

    const load = async () => {
      revoke();
      setBlobUrl(null);
      setTextContent(null);
      setError(null);

      if (!privateUrl) {
        setError("Este archivo no tiene URL accesible.");
        return;
      }

      if (kind === "office" || kind === "unknown") {
        // No intentamos bajar binarios que no podemos previsualizar.
        return;
      }

      setLoading(true);
      try {
        const blob = await fetchSlackPrivateFileBlob(privateUrl);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);

        if (kind === "text") {
          const text = await blob.text();
          if (!cancelled) setTextContent(text);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No se pudo cargar la previsualización.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, file, kind, privateUrl, revoke]);

  useEffect(() => {
    if (!open) {
      revoke();
      setBlobUrl(null);
      setTextContent(null);
      setError(null);
      setLoading(false);
    }
  }, [open, revoke]);

  useEffect(() => {
    return () => {
      revoke();
    };
  }, [revoke]);

  const handleDownload = useCallback(async () => {
    if (!file) return;
    try {
      const url = blobUrl || (privateUrl ? URL.createObjectURL(await fetchSlackPrivateFileBlob(privateUrl)) : null);
      if (!url) {
        toast.error("No se pudo descargar el archivo.");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = label;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar el archivo.");
    }
  }, [blobUrl, file, label, privateUrl]);

  const handleOpenInSlack = useCallback(() => {
    if (!file?.permalink) return;
    window.open(file.permalink, "_blank", "noopener,noreferrer");
  }, [file]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 pt-0 gap-0 flex flex-col overflow-hidden",
          "sm:max-w-5xl sm:w-[min(1100px,95vw)] sm:h-[90vh] sm:max-h-[90vh] sm:rounded-xl",
        )}
      >
        <header className="flex items-start gap-3 border-b border-border/70 bg-background px-4 py-3 pr-14">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <KindIcon kind={kind} className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold">{label}</DialogTitle>
            <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wide">
                {kindLabel(kind)}
              </Badge>
              {sizeLabel && <span className="text-muted-foreground">{sizeLabel}</span>}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {file?.permalink && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleOpenInSlack}
                title="Abrir en Slack"
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Slack
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => void handleDownload()}
              disabled={!file}
              title="Descargar"
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Descargar
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-stretch justify-stretch bg-muted/30">
          {loading && (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{error}</p>
              {privateUrl && (
                <Button size="sm" variant="outline" onClick={() => void handleDownload()}>
                  <Download className="mr-1 h-4 w-4" />
                  Descargar
                </Button>
              )}
            </div>
          )}

          {!loading && !error && kind === "image" && blobUrl && (
            <div className="flex flex-1 items-center justify-center overflow-auto p-4">
              <img
                src={blobUrl}
                alt={label}
                className="max-h-full max-w-full object-contain rounded shadow-sm"
              />
            </div>
          )}

          {!loading && !error && kind === "pdf" && blobUrl && (
            <iframe
              src={`${blobUrl}#toolbar=1&navpanes=0`}
              title={label}
              className="flex-1 h-full w-full border-0 bg-background"
            />
          )}

          {!loading && !error && kind === "video" && blobUrl && (
            <div className="flex flex-1 items-center justify-center overflow-hidden bg-black/60 p-2">
              <video
                src={blobUrl}
                controls
                className="max-h-full max-w-full rounded"
              />
            </div>
          )}

          {!loading && !error && kind === "audio" && blobUrl && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-muted text-muted-foreground">
                <Music2 className="h-8 w-8" />
              </div>
              <p className="max-w-md truncate text-sm font-medium text-foreground" title={label}>
                {label}
              </p>
              <audio src={blobUrl} controls className="w-full max-w-md" />
            </div>
          )}

          {!loading && !error && kind === "text" && textContent != null && (
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground">
              {textContent}
            </pre>
          )}

          {!loading && !error && (kind === "office" || kind === "unknown") && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              {kind === "office" ? (
                <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50" />
              ) : (
                <FileText className="h-12 w-12 text-muted-foreground/50" />
              )}
              <div>
                <p className="font-medium text-foreground">Vista previa no disponible</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {kind === "office"
                    ? "Descarga el archivo para abrirlo en tu aplicación de escritorio."
                    : "Este tipo de archivo no se puede previsualizar dentro de Kawiil."}
                </p>
              </div>
              <Button onClick={() => void handleDownload()}>
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
