import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  File as FileIcon,
  Download,
  Eye,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface AttachmentCardData {
  name: string;
  url: string;
  /** Origen conocido del adjunto; ayuda a decidir ícono y vista previa. */
  kind?: "image" | "dropbox" | "link";
}

type FileKind = "pdf" | "image" | "spreadsheet" | "archive" | "code" | "doc" | "text" | "other";

/** Ícono + color + etiqueta por tipo de archivo (mismo lenguaje visual que la pestaña Archivos). */
const KIND_META: Record<FileKind, { Icon: typeof FileText; color: string; label: string }> = {
  pdf: { Icon: FileText, color: "text-red-500", label: "PDF" },
  image: { Icon: FileImage, color: "text-emerald-500", label: "Imagen" },
  spreadsheet: { Icon: FileSpreadsheet, color: "text-blue-500", label: "Hoja de cálculo" },
  archive: { Icon: FileArchive, color: "text-amber-600", label: "Comprimido" },
  code: { Icon: FileCode, color: "text-orange-500", label: "Código" },
  doc: { Icon: FileText, color: "text-sky-500", label: "Documento" },
  text: { Icon: FileText, color: "text-amber-600", label: "Texto" },
  other: { Icon: FileIcon, color: "text-muted-foreground", label: "Archivo" },
};

function extensionOf(nameOrUrl: string): string {
  return nameOrUrl.toLowerCase().split(/[?#]/)[0].split(".").pop() ?? "";
}

function detectKind(name: string, explicit?: string): FileKind {
  if (explicit === "image") return "image";
  const ext = extensionOf(name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["xlsx", "xls", "csv"].includes(ext)) return "spreadsheet";
  if (["zip", "rar", "7z"].includes(ext)) return "archive";
  if (["xml", "json", "html", "md"].includes(ext)) return "code";
  if (["doc", "docx", "ppt", "pptx"].includes(ext)) return "doc";
  if (["txt", "log"].includes(ext)) return "text";
  return "other";
}

const isHttp = (u: string) => /^https?:\/\//i.test(u);

/**
 * Tarjeta de adjunto para comentarios: ícono según tipo, nombre, vista previa
 * (imágenes y PDF) y descarga. Reutilizable en el detalle de tarea y en la
 * edición rápida en línea.
 */
export function AttachmentCard({ name, url, kind }: AttachmentCardData) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const isDropbox = kind === "dropbox" || url.includes("dropbox.com");
  const fileKind = detectKind(name, kind);
  const { Icon, color, label } = KIND_META[fileKind];
  const canPreview = !isDropbox && isHttp(url) && (fileKind === "image" || fileKind === "pdf");
  const showThumb = fileKind === "image" && isHttp(url);

  const handleDownload = async () => {
    // Dropbox / enlaces externos: abrir en pestaña nueva (no se pueden descargar directo).
    if (isDropbox || !isHttp(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setDownloading(true);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("fetch failed");
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: abrir en pestaña nueva si la descarga directa falla (CORS, etc.).
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 max-w-full sm:max-w-md">
        {showThumb ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="shrink-0 rounded overflow-hidden border border-border/40"
            title="Vista previa"
          >
            <img src={url} alt={name} className="h-9 w-9 object-cover" />
          </button>
        ) : (
          <Icon className={cn("h-4 w-4 shrink-0", color)} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={name}>
            {name}
          </p>
          <span className="text-[10px] text-muted-foreground">{isDropbox ? "Dropbox" : label}</span>
        </div>
        {canPreview && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            title="Vista previa"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          title={isDropbox ? "Abrir" : "Descargar"}
          disabled={downloading}
          onClick={handleDownload}
        >
          {downloading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isDropbox ? (
            <ExternalLink className="h-3 w-3" />
          ) : (
            <Download className="h-3 w-3" />
          )}
        </Button>
      </div>

      {canPreview && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <div className="flex items-center gap-2 pr-8">
                <Icon className={cn("h-5 w-5 shrink-0", color)} />
                <DialogTitle className="truncate flex-1 text-left">{name}</DialogTitle>
                <Badge variant="outline" className="text-xs shrink-0">
                  {label}
                </Badge>
                <Button size="sm" variant="default" className="shrink-0" onClick={handleDownload} disabled={downloading}>
                  <Download className="h-4 w-4 mr-1" />
                  Descargar
                </Button>
              </div>
            </DialogHeader>
            <div className="flex-1 min-h-0 rounded-md border bg-muted/30 overflow-auto">
              {fileKind === "image" ? (
                <div className="flex items-center justify-center p-4">
                  <img src={url} alt={name} className="max-w-full max-h-[70vh] object-contain rounded" />
                </div>
              ) : (
                <iframe src={`${url}#toolbar=1&navpanes=0`} className="w-full h-[70vh] rounded" title={name} />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
