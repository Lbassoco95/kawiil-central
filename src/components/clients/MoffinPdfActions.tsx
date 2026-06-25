import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ACTIVE_SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, ExternalLink, Eye, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  filePath: string;
  fileName?: string | null;
  className?: string;
};

function buildAbsoluteSignedUrl(signedUrl: string) {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) return signedUrl;
  return `${ACTIVE_SUPABASE_URL}/storage/v1${signedUrl}`;
}

export function MoffinPdfActions({ filePath, fileName, className }: Props) {
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const getUrl = async () => {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(filePath, 3600);
    if (error || !data?.signedUrl) {
      toast.error("No se pudo generar el enlace del PDF");
      return null;
    }
    return buildAbsoluteSignedUrl(data.signedUrl);
  };

  /** Verifica que el archivo realmente empiece con %PDF (no un JSON de error de Moffin). */
  const isPdfContent = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const head = new Uint8Array(await res.clone().arrayBuffer()).slice(0, 5);
      return String.fromCharCode(...head).startsWith("%PDF");
    } catch {
      // Si no pudimos validar (red/CORS), no bloqueamos: dejamos que el iframe lo intente.
      return true;
    }
  };

  const preview = async () => {
    setBusy("preview");
    setPreviewError(null);
    try {
      const url = await getUrl();
      if (!url) return;
      const ok = await isPdfContent(url);
      if (!ok) {
        setPreviewError(
          "El documento guardado no es un PDF válido. Suele ser un error temporal del SAT/Moffin al generarlo. Vuelve a sincronizar o reintenta la consulta para descargarlo de nuevo.",
        );
        setPreviewUrl(null);
        setPreviewOpen(true);
        return;
      }
      setPreviewUrl(url);
      setPreviewOpen(true);
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    try {
      const url = await getUrl();
      if (!url) return;
      const base = fileName?.replace(/\.[^/.]+$/, "").trim() || "documento-sat";
      const safeName = /\.pdf$/i.test(fileName ?? "") ? (fileName as string) : `${base}.pdf`;
      const a = document.createElement("a");
      a.href = url;
      a.download = safeName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setBusy(null);
    }
  };

  const displayName = fileName?.trim() || "Documento SAT";

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-1", className)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] gap-0.5"
          onClick={preview}
          disabled={!!busy}
          aria-label="Vista previa del PDF"
        >
          {busy === "preview" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Eye className="h-3 w-3" />
          )}
          Ver
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[10px] gap-0.5"
          onClick={download}
          disabled={!!busy}
          aria-label="Descargar PDF"
        >
          {busy === "download" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Descargar
        </Button>
      </div>

      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) {
            setPreviewUrl(null);
            setPreviewError(null);
          }
        }}
      >
        <DialogContent className="max-w-[1600px] w-[96vw] h-[94vh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-3 border-b shrink-0 flex flex-row items-center justify-between gap-3 space-y-0">
            <DialogTitle className="text-sm font-medium truncate flex-1">
              {displayName}
            </DialogTitle>
            <div className="flex items-center gap-1 shrink-0 mr-6">
              {previewUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] gap-1"
                  onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
                  aria-label="Abrir en pestaña nueva"
                >
                  <ExternalLink className="h-3 w-3" />
                  Pestaña
                </Button>
              ) : null}
              {!previewError ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px] gap-1"
                  onClick={download}
                  disabled={!!busy}
                >
                  {busy === "download" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  Descargar
                </Button>
              ) : null}
            </div>
          </DialogHeader>
          <div className="flex-1 bg-muted/20 min-h-0">
            {previewError ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <p className="text-sm text-muted-foreground max-w-md">{previewError}</p>
              </div>
            ) : previewUrl ? (
              <iframe
                src={`${previewUrl}#toolbar=1&navpanes=0&view=FitH`}
                className="w-full h-full border-0"
                title={`Preview ${displayName}`}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
