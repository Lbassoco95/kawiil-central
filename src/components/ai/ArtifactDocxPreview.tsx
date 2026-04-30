import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";

interface ArtifactDocxPreviewProps {
  bucket: string;
  storagePath: string;
  /** Si true, el área crece al alto disponible del panel. */
  fitContainer?: boolean;
}

/**
 * Vista previa HTML del archivo DOCX (mismo enfoque que adjuntos Word en EmailView).
 */
export function ArtifactDocxPreview({ bucket, storagePath, fitContainer = true }: ArtifactDocxPreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: dlErr } = await supabase.storage.from(bucket).download(storagePath);
        if (dlErr || !data) throw new Error(dlErr?.message || "No se pudo descargar el archivo Word");
        const mammoth = await import("mammoth");
        const arrayBuffer = await data.arrayBuffer();
        const { value } = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setHtml(DOMPurify.sanitize(value, { USE_PROFILES: { html: true } }));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo convertir el documento");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bucket, storagePath]);

  if (loading) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-muted-foreground ${fitContainer ? "h-full min-h-[280px]" : "min-h-[280px]"}`}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs">Cargando vista previa Word…</p>
      </div>
    );
  }
  if (error || !html) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-destructive ${fitContainer ? "h-full min-h-[280px]" : "min-h-[280px]"}`}>
        <AlertCircle className="h-5 w-5" />
        <p className="text-xs max-w-[280px] text-center">{error || "No se pudo mostrar la vista previa."}</p>
      </div>
    );
  }

  return (
    <div className={`${fitContainer ? "h-full min-h-[min(70vh,800px)]" : ""} w-full overflow-y-auto bg-muted/20`}>
      <div
        className="mx-auto max-w-[816px] bg-background shadow-sm border rounded-md px-8 py-10 my-4 prose prose-sm max-w-none [&_p]:my-2 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_table]:text-xs [&_td]:border [&_th]:border"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
