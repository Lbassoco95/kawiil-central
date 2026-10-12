import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

const W = 600;
const H = 200;

interface SignaturePadProps {
  /** Recibe un data URL PNG (fondo transparente) o null si está vacía. */
  onChange: (png: string | null) => void;
  defaultTypedName?: string;
  className?: string;
}

/** Firma dibujada con mouse/dedo, o escrita (tipografía cursiva). */
export function SignaturePad({ onChange, defaultTypedName = "", className }: SignaturePadProps) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(defaultTypedName);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  const clear = useCallback(() => {
    const c = ctx();
    if (c) c.clearRect(0, 0, W, H);
    dirty.current = false;
    onChange(null);
  }, [onChange]);

  const emit = useCallback(() => {
    const c = canvasRef.current;
    if (c && dirty.current) onChange(c.toDataURL("image/png"));
    else onChange(null);
  }, [onChange]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = ctx();
    if (!c) return;
    const p = pos(e);
    c.lineWidth = 3;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = "#111827";
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x + 0.01, p.y + 0.01);
    c.stroke();
    drawing.current = true;
    dirty.current = true;
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ctx();
    if (!c) return;
    const p = pos(e);
    c.lineTo(p.x, p.y);
    c.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    emit();
  };

  // Modo "escribir": renderiza el nombre en el mismo canvas.
  useEffect(() => {
    if (mode !== "type") return;
    const c = ctx();
    if (!c) return;
    c.clearRect(0, 0, W, H);
    const text = typed.trim();
    if (!text) {
      dirty.current = false;
      onChange(null);
      return;
    }
    let size = 72;
    c.font = `italic ${size}px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive`;
    while (c.measureText(text).width > W - 40 && size > 24) {
      size -= 4;
      c.font = `italic ${size}px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive`;
    }
    c.fillStyle = "#111827";
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.fillText(text, W / 2, H / 2);
    dirty.current = true;
    onChange(canvasRef.current!.toDataURL("image/png"));
  }, [mode, typed, onChange]);

  const switchMode = (m: "draw" | "type") => {
    setMode(m);
    clear();
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1">
        <Button type="button" size="sm" variant={mode === "draw" ? "default" : "outline"} onClick={() => switchMode("draw")}>
          Dibujar
        </Button>
        <Button type="button" size="sm" variant={mode === "type" ? "default" : "outline"} onClick={() => switchMode("type")}>
          Escribir
        </Button>
        {mode === "draw" && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto gap-1" onClick={clear}>
            <Eraser className="h-3.5 w-3.5" /> Borrar
          </Button>
        )}
      </div>
      {mode === "type" && (
        <Input placeholder="Escribe tu nombre completo" value={typed} onChange={(e) => setTyped(e.target.value)} />
      )}
      <div className="rounded-md border bg-white">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className={cn("w-full touch-none", mode === "draw" ? "cursor-crosshair" : "pointer-events-none")}
          style={{ aspectRatio: `${W} / ${H}` }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </div>
      {mode === "draw" && <p className="text-xs text-muted-foreground">Firma dentro del recuadro con el mouse o el dedo.</p>}
    </div>
  );
}
