import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { DEFAULT_FIELD, loadPdfjs } from "@/lib/esignPdf";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PdfFieldBox {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label?: string;
}

interface PdfPagesProps {
  source: { data: Uint8Array } | { url: string };
  fields: PdfFieldBox[];
  /** place: clic en la hoja añade un recuadro; los recuadros se arrastran y se quitan. view: solo muestra. */
  mode: "place" | "view";
  onAdd?: (page: number, x: number, y: number) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onRemove?: (id: string) => void;
  /** Se llama cuando el PDF ya se pudo abrir (o falló) para habilitar/avisar en la UI. */
  onLoaded?: () => void;
  onError?: (message: string) => void;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

function PageView({
  doc, pageNumber, fields, mode, onAdd, onMove, onRemove,
}: { doc: any; pageNumber: number } & Omit<PdfPagesProps, "source">) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.707);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: any = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (820 * dpr) / base.width });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = vp.width;
      canvas.height = vp.height;
      setRatio(vp.height / vp.width);
      task = page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp });
      try {
        await task.promise;
      } catch {
        /* render cancelado */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [doc, pageNumber]);

  const rel = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPageClick = (e: React.MouseEvent) => {
    if (mode !== "place" || !onAdd) return;
    if ((e.target as HTMLElement).closest("[data-field]")) return;
    const r = wrapRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - DEFAULT_FIELD.w / 2;
    const y = (e.clientY - r.top) / r.height - DEFAULT_FIELD.h / 2;
    onAdd(pageNumber, clamp(x, 0, 1 - DEFAULT_FIELD.w), clamp(y, 0, 1 - DEFAULT_FIELD.h));
  };

  const pageFields = fields.filter((f) => f.page === pageNumber);

  return (
    <div className="mx-auto w-full max-w-[820px]">
      <p className="mb-1 text-xs text-muted-foreground">Página {pageNumber} de {doc.numPages}</p>
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded border bg-white shadow-sm"
        style={{ aspectRatio: `1 / ${ratio}`, cursor: mode === "place" ? "crosshair" : "default" }}
        onClick={onPageClick}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {pageFields.map((f) => (
          <div
            key={f.id}
            data-field
            className="absolute flex items-center justify-center rounded-sm text-[11px] font-medium select-none"
            style={{
              left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`,
              border: `2px ${mode === "place" ? "solid" : "dashed"} ${f.color}`,
              background: `${f.color}22`, color: f.color,
              cursor: mode === "place" ? "grab" : "default", touchAction: "none",
            }}
            onPointerDown={(e) => {
              if (mode !== "place") return;
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const p = rel(e);
              drag.current = { id: f.id, dx: p.x - f.x, dy: p.y - f.y, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== f.id) return;
              const p = rel(e);
              d.moved = true;
              onMove?.(f.id, clamp(p.x - d.dx, 0, 1 - f.w), clamp(p.y - d.dy, 0, 1 - f.h));
            }}
            onPointerUp={() => { drag.current = null; }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate px-1">{f.label}</span>
            {mode === "place" && (
              <button
                type="button"
                aria-label="Quitar recuadro"
                className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-background shadow"
                style={{ border: `1px solid ${f.color}` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onRemove?.(f.id); }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Renderiza todas las páginas de un PDF con recuadros de firma encima (pdfjs, sin iframe). */
export function PdfPages({ source, fields, mode, onAdd, onMove, onRemove, onLoaded, onError }: PdfPagesProps) {
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const key = "data" in source ? source.data : source.url;

  useEffect(() => {
    let cancelled = false;
    let loaded: any = null;
    setDoc(null);
    setError(null);
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        // pdfjs transfiere el buffer al worker: se le pasa una copia.
        const params = "data" in source ? { data: source.data.slice() } : { url: source.url };
        loaded = await pdfjs.getDocument(params).promise;
        if (!cancelled) {
          setDoc(loaded);
          onLoaded?.();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "No se pudo abrir el PDF";
        if (!cancelled) {
          setError(msg);
          onError?.(msg);
        }
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!doc) {
    return (
      <div className="flex items-center justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PageView key={i + 1} doc={doc} pageNumber={i + 1} fields={fields} mode={mode} onAdd={onAdd} onMove={onMove} onRemove={onRemove} />
      ))}
    </div>
  );
}
