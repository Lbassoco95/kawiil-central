import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, ExternalLink, FileText, Image, FileSpreadsheet, Code, Loader2, X } from "lucide-react";
import { ACTIVE_SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    id: string;
    name: string;
    mime_type?: string | null;
    file_path?: string | null;
    source: string;
    external_path?: string | null;
    file_size?: number | null;
  } | null;
}

function getFileType(name: string, mimeType?: string | null): "pdf" | "image" | "xml" | "text" | "office" | "unknown" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType?.includes("pdf") || ext === "pdf") return "pdf";
  if (mimeType?.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (mimeType?.includes("xml") || ext === "xml") return "xml";
  if (["txt", "csv", "md", "log"].includes(ext) || mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "text/markdown") return "text";
  if (["xlsx", "xls", "docx", "doc", "pptx", "ppt"].includes(ext) ||
      mimeType?.includes("spreadsheet") || mimeType?.includes("document") || mimeType?.includes("presentation")) return "office";
  return "unknown";
}

function getFileIcon(type: string) {
  switch (type) {
    case "pdf": return <FileText className="h-5 w-5 text-red-500" />;
    case "image": return <Image className="h-5 w-5 text-green-500" />;
    case "xml": return <Code className="h-5 w-5 text-orange-500" />;
    case "text": return <FileText className="h-5 w-5 text-amber-600" />;
    case "office": return <FileSpreadsheet className="h-5 w-5 text-blue-500" />;
    default: return <FileText className="h-5 w-5 text-muted-foreground" />;
  }
}

function getFileLabel(type: string) {
  switch (type) {
    case "pdf": return "PDF";
    case "image": return "Imagen";
    case "xml": return "XML";
    case "text": return "Texto";
    case "office": return "Office";
    default: return "Archivo";
  }
}

function buildAbsoluteSignedUrl(signedUrl: string) {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) return signedUrl;
  return `${ACTIVE_SUPABASE_URL}/storage/v1${signedUrl}`;
}

export function DocumentPreviewDialog({ open, onOpenChange, document }: DocumentPreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  const fileType = document ? getFileType(document.name, document.mime_type) : "unknown";

  const loadPreview = async () => {
    if (!document?.file_path || document.source !== "supabase") return;
    setLoading(true);
    setPreviewUrl(null);
    setTextContent(null);

    try {
      if (fileType === "xml" || fileType === "text") {
        const { data, error } = await supabase.storage
          .from("documents")
          .createSignedUrl(document.file_path, 3600);
        if (error) throw error;
        const signedUrl = buildAbsoluteSignedUrl(data.signedUrl);
        const resp = await fetch(signedUrl);
        const text = await resp.text();
        setTextContent(text);
        if (fileType === "xml") setPreviewUrl(signedUrl);
      } else {
        const { data, error } = await supabase.storage
          .from("documents")
          .download(document.file_path);
        if (error) throw error;
        const blobUrl = URL.createObjectURL(data);
        setPreviewUrl(blobUrl);
      }
    } catch (err: any) {
      setPreviewUrl(null);
      setTextContent(null);
      toast.error("Error al cargar preview: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && document?.source === "supabase" && document?.file_path) {
      void loadPreview();
    }
    if (!open && previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (!open) setTextContent(null);
  }, [open, document?.id]);

  const handleDownload = async () => {
    if (!document) return;

    if (document.source === "dropbox" && document.external_path) {
      window.open(document.external_path, "_blank");
      return;
    }

    if (!document.file_path) return;

    try {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(document.file_path, 60, { download: true });
      if (error) throw error;

      const fileUrl = buildAbsoluteSignedUrl(data.signedUrl);
      const a = window.document.createElement("a");
      a.href = fileUrl;
      a.download = document.name;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
    } catch (err: any) {
      toast.error("Error al descargar: " + err.message);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setPreviewUrl(null);
      setTextContent(null);
    }
    onOpenChange(o);
  };

  const isDropbox = document?.source === "dropbox";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {getFileIcon(fileType)}
            <div className="flex-1 min-w-0">
              <DialogTitle className="truncate">{document?.name ?? "Documento"}</DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">{getFileLabel(fileType)}</Badge>
                {document?.file_size && (
                  <span className="text-xs text-muted-foreground">
                    {(document.file_size / 1024).toFixed(0)} KB
                  </span>
                )}
                {isDropbox && <Badge variant="secondary" className="text-xs">Dropbox</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isDropbox && document?.external_path && (
                <Button variant="outline" size="sm" asChild>
                  <a href={document.external_path} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Abrir en Dropbox
                  </a>
                </Button>
              )}
              <Button variant="default" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" />
                Descargar
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 rounded-md border bg-muted/30 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {isDropbox && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-6">
              <ExternalLink className="h-12 w-12 text-muted-foreground/50" />
              <div>
                <p className="font-medium text-foreground">Archivo alojado en Dropbox</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Haz clic en "Abrir en Dropbox" para ver el archivo en su ubicación original.
                </p>
              </div>
              {document?.external_path && (
                <Button variant="outline" asChild>
                  <a href={document.external_path} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Abrir en Dropbox
                  </a>
                </Button>
              )}
            </div>
          )}

          {!isDropbox && !loading && previewUrl && fileType === "pdf" && (
            <iframe
              src={previewUrl + "#toolbar=1&navpanes=0"}
              className="w-full h-[60vh] rounded"
              title={document?.name}
            />
          )}

          {!isDropbox && !loading && previewUrl && fileType === "image" && (
            <div className="flex items-center justify-center p-4">
              <img
                src={previewUrl}
                alt={document?.name}
                className="max-w-full max-h-[60vh] object-contain rounded"
              />
            </div>
          )}

          {!isDropbox && !loading && textContent && (fileType === "xml" || fileType === "text") && (
            <pre className="p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
              {textContent}
            </pre>
          )}

          {!isDropbox && !loading && previewUrl && fileType === "office" && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-6">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50" />
              <div>
                <p className="font-medium text-foreground">Vista previa no disponible para archivos Office</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Descarga el archivo para abrirlo en tu aplicación de escritorio.
                </p>
              </div>
              <Button variant="default" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" />
                Descargar archivo
              </Button>
            </div>
          )}

          {!isDropbox && !loading && !previewUrl && !textContent && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No se pudo generar la vista previa</p>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" />
                Descargar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
