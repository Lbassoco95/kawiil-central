import { useEffect, useState } from "react";
import { ACTIVE_SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { FileText, Loader2, AlertCircle } from "lucide-react";

interface ArtifactPdfPreviewProps {
  bucket: string;
  path: string;
  /** Si true, el preview se ajusta al contenedor completo. */
  fitContainer?: boolean;
}

function buildAbsoluteSignedUrl(signedUrl: string) {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) return signedUrl;
  return `${ACTIVE_SUPABASE_URL}/storage/v1${signedUrl}`;
}

/**
 * Preview real del PDF generado por Kawiil AI.
 *
 * Resuelve un signed URL de Storage y lo renderiza en un `<iframe>`
 * (el navegador usa su visor nativo de PDF). Sigue el mismo patrón
 * que `DocumentPreviewDialog` para consistencia visual.
 */
export function ArtifactPdfPreview({ bucket, path, fitContainer = true }: ArtifactPdfPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 3600);
        if (err || !data?.signedUrl) throw new Error(err?.message || "No se pudo firmar la URL del PDF");
        if (!cancelled) setUrl(buildAbsoluteSignedUrl(data.signedUrl));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error al cargar el PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  if (loading) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-muted-foreground ${fitContainer ? "h-full" : "min-h-[280px]"}`}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs">Cargando preview del PDF…</p>
      </div>
    );
  }
  if (error || !url) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-destructive ${fitContainer ? "h-full" : "min-h-[280px]"}`}>
        <AlertCircle className="h-5 w-5" />
        <p className="text-xs max-w-[280px] text-center">{error || "No se pudo cargar el PDF."}</p>
      </div>
    );
  }

  return (
    <div
      className={`${fitContainer ? "h-full min-h-[min(70vh,800px)]" : "h-[720px] min-h-[min(70vh,800px)]"} w-full bg-muted/20 flex flex-col`}
    >
      <iframe
        src={`${url}#toolbar=1&navpanes=0&view=FitV`}
        className="w-full flex-1 min-h-0 h-full"
        title="Preview del documento PDF"
      />
      <div className="sr-only">
        <FileText aria-hidden="true" /> PDF preview
      </div>
    </div>
  );
}
