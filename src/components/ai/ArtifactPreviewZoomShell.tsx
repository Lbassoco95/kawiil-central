import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

const ZOOM_LEVELS = [50, 67, 75, 85, 90, 100, 110, 125, 150, 175, 200] as const;

export interface ArtifactPreviewZoomShellProps {
  children: React.ReactNode;
  /** Al cambiar (p. ej. otro artefacto), el zoom vuelve al nivel por defecto. */
  resetKey?: string;
}

function defaultZoomIndex() {
  const i = ZOOM_LEVELS.indexOf(90);
  return i >= 0 ? i : ZOOM_LEVELS.indexOf(100);
}

/**
 * Barra de zoom + área con scroll vertical y horizontal sobre contenido escalado
 * (iframe Office/PDF con tamaño lógico amplio para poder recorrer el documento).
 */
export function ArtifactPreviewZoomShell({ children, resetKey }: ArtifactPreviewZoomShellProps) {
  const [zoomIndex, setZoomIndex] = useState(defaultZoomIndex);

  useEffect(() => {
    setZoomIndex(defaultZoomIndex());
  }, [resetKey]);

  const zi = Math.min(Math.max(zoomIndex, 0), ZOOM_LEVELS.length - 1);
  const zoomPct = ZOOM_LEVELS[zi];
  const scale = zoomPct / 100;

  return (
    <div className="flex min-h-0 min-w-0 flex-[1_1_0] flex-col basis-0">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 bg-muted/50 px-2 py-1">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Zoom</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
          disabled={zi <= 0}
          aria-label="Alejar"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs font-medium tabular-nums">{zoomPct}%</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
          disabled={zi >= ZOOM_LEVELS.length - 1}
          aria-label="Acercar"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => {
            const i = ZOOM_LEVELS.indexOf(100);
            setZoomIndex(i >= 0 ? i : defaultZoomIndex());
          }}
          aria-label="Restablecer zoom al 100%"
        >
          <RotateCcw className="h-3 w-3 shrink-0" />
          100%
        </Button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-[1_1_0] basis-0 overflow-auto overscroll-contain">
        <div
          className="inline-block origin-top-left align-top"
          style={{
            transform: `scale(${scale})`,
            width: `${100 / scale}%`,
          }}
        >
          <div
            className="box-border w-full bg-background"
            style={{ minWidth: 1080, minHeight: "max(880px, min(72vh, 1100px))" }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
