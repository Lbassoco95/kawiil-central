import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, MoreHorizontal } from "lucide-react";
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
  /** Marco amplio para scroll + zoom en el visor del Asistente (Word/Excel/PPT). */
  panZoomEmbed?: boolean;
}

/**
 * Vista previa vía Microsoft Office Online (`view.officeapps.live.com`).
 * Chrome mínimo: la descarga va en la barra del visor principal.
 */
export function ArtifactOfficeOnlinePreview({
  bucket,
  storagePath,
  suiteLabel,
  simplifiedFallback,
  fitContainer = true,
  panZoomEmbed = false,
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
          panZoomEmbed ? "min-h-[880px] w-full min-w-[1080px]" : fitContainer ? "h-full min-h-[280px]" : "min-h-[280px]"
        }`}
      >
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs">Cargando vista previa de {suiteLabel}…</p>
      </div>
    );
  }

  if (!embedUrl) {
    return <>{simplifiedFallback}</>;
  }

  const frameClass = panZoomEmbed
    ? "relative flex h-full min-h-[880px] w-full min-w-[1080px] flex-col"
    : `relative flex flex-col ${fitContainer ? "min-h-0 flex-1 h-full" : ""}`;

  return (
    <div className={frameClass}>
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="pointer-events-auto h-8 w-8 border border-border/60 bg-background/90 shadow-sm backdrop-blur-sm"
              aria-label={`Más opciones de vista previa ${suiteLabel}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => window.open(embedUrl, "_blank", "noopener,noreferrer")}>
              Abrir en nueva pestaña
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setUseSimplified(true)}>Vista simplificada en la app</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <iframe
        title={`Vista previa ${suiteLabel}`}
        src={embedUrl}
        className={`w-full border-0 bg-background ${panZoomEmbed ? "min-h-[880px] flex-1" : fitContainer ? "min-h-0 flex-1 h-full" : "min-h-[480px]"}`}
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
