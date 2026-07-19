import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, ExternalLink, FileText } from "lucide-react";
import { getCvSignedUrl } from "@/hooks/useRecruitment";

export interface PreviewTarget {
  path: string;
  name: string;
}

type Kind = "pdf" | "image" | "office" | "other";

function kindFor(name: string): Kind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg"].includes(ext)) return "image";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "office";
  return "other";
}

/**
 * Visor de documentos embebido: muestra PDF e imágenes de forma nativa y documentos
 * de Office (Word/Excel/PowerPoint) con el visor de Office Online. Siempre permite
 * descargar y abrir en una pestaña nueva.
 */
export function DocumentPreviewDialog({
  target,
  open,
  onOpenChange,
}: {
  target: PreviewTarget | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const kind = target ? kindFor(target.name) : "other";

  useEffect(() => {
    let active = true;
    if (open && target) {
      setLoading(true);
      setUrl(null);
      getCvSignedUrl(target.path).then((u) => {
        if (active) {
          setUrl(u);
          setLoading(false);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [open, target]);

  async function handleDownload() {
    if (!target) return;
    setDownloading(true);
    const dl = await getCvSignedUrl(target.path, { download: target.name });
    setDownloading(false);
    if (dl) window.location.href = dl;
  }

  const officeSrc =
    kind === "office" && url
      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3 space-y-0">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{target?.name ?? "Documento"}</span>
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-2 pr-6">
            {url && (
              <Button size="sm" variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir
                </a>
              </Button>
            )}
            <Button size="sm" onClick={handleDownload} disabled={downloading}>
              {downloading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Descargar
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-muted/30">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !url ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No se pudo cargar el documento. Intenta descargarlo.
            </div>
          ) : kind === "image" ? (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              <img src={url} alt={target?.name ?? ""} className="max-h-full max-w-full object-contain" />
            </div>
          ) : kind === "pdf" ? (
            <iframe src={url} title={target?.name ?? "Documento"} className="h-full w-full border-0" />
          ) : officeSrc ? (
            <iframe src={officeSrc} title={target?.name ?? "Documento"} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <p>Este tipo de archivo no se puede previsualizar. Descárgalo para verlo.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
