import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, Rows3 } from "lucide-react";
import { buildAbsoluteSignedStorageUrl, buildMicrosoftOfficeEmbedUrl } from "@/lib/officeOnlineEmbed";

const SIGNED_URL_TTL_SEC = 3600;

interface ArtifactOfficeOnlinePreviewProps {
  bucket: string;
  storagePath: string;
  /** Etiqueta para accesibilidad y mensajes cortos (Word, Excel, PowerPoint). */
  suiteLabel: string;
  /** Vista previa local cuando Office Online falla o el usuario la elige. */
  simplifiedFallback: ReactNode;
  /** Si true, el bloque ocupa el alto disponible del panel. */
  fitContainer?: boolean;
}

/**
 * Vista previa de alta fidelidad vía Microsoft Office Online (`view.officeapps.live.com`).
 * Microsoft obtiene el archivo desde la URL firmada de Supabase Storage.
 */
export function ArtifactOfficeOnlinePreview({
  bucket,
  storagePath,
  suiteLabel,
  simplifiedFallback,
  fitContainer = true,
}: ArtifactOfficeOnlinePreviewProps) {
  const [loading, setLoading] = useState(true);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [useSimplified, setUseSimplified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEmbedUrl(null);
    setUseSimplified(false);

    (async () => {
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          throw new Error(error?.message || "No se pudo preparar la vista previa");
        }
        const absolute = buildAbsoluteSignedStorageUrl(data.signedUrl);
        setEmbedUrl(buildMicrosoftOfficeEmbedUrl(absolute));
      } catch {
        if (!cancelled) setUseSimplified(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bucket, storagePath]);

  if (useSimplified) {
    return <>{simplifiedFallback}</>;
  }

  if (loading) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 text-muted-foreground ${
          fitContainer ? "h-full min-h-[280px]" : "min-h-[280px]"
        }`}
      >
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs">Preparando vista previa de {suiteLabel} (Office Online)…</p>
      </div>
    );
  }

  if (!embedUrl) {
    return <>{simplifiedFallback}</>;
  }

  return (
    <div className={`flex flex-col ${fitContainer ? "min-h-0 flex-1 h-full" : ""}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 bg-muted/20 px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          onClick={() => window.open(embedUrl, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          Abrir vista previa en nueva pestaña
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] gap-1 text-muted-foreground"
          onClick={() => setUseSimplified(true)}
        >
          <Rows3 className="h-3 w-3 shrink-0" />
          Vista simplificada en la app
        </Button>
      </div>
      <iframe
        title={`Vista previa ${suiteLabel}`}
        src={embedUrl}
        className={`w-full shrink-0 border-0 bg-background ${fitContainer ? "min-h-[min(70vh,800px)] flex-1" : "min-h-[480px]"}`}
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <p className="shrink-0 px-2 py-1 text-[10px] text-muted-foreground">
        Vista previa con Microsoft Office Online (solo lectura). Si no carga, usa «Vista simplificada» o{" "}
        <span className="font-medium text-foreground">Descargar</span>.
      </p>
    </div>
  );
}
