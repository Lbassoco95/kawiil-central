import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, RotateCcw } from "lucide-react";

/** Paleta amplia para calendarios y categorías. */
export const COLOR_PALETTE = [
  "#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6",
  "#10b981", "#22c55e", "#84cc16", "#eab308",
  "#f59e0b", "#f97316", "#ef4444", "#f43f5e",
  "#ec4899", "#d946ef", "#a855f7", "#8b5cf6",
  "#6366f1", "#64748b", "#78716c", "#0f766e",
];

/** Color determinista (hex) a partir de un texto, tomado de la paleta. */
export function paletteColorFor(key?: string | null): string {
  if (!key) return COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash + key.charCodeAt(i)) % 2147483647;
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

/** Convierte #rrggbb + alpha (0..1) a #rrggbbaa. */
export function hexAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}

interface Props {
  value: string;
  onChange: (color: string) => void;
  onReset?: () => void;
  ariaLabel?: string;
  size?: number;
}

/** Muestra un swatch de color; al hacer clic abre una paleta para elegir otro. */
export function ColorPickerPopover({ value, onChange, onReset, ariaLabel = "Elegir color", size = 12 }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className="rounded-[4px] border shrink-0 transition-transform hover:scale-110"
          style={{ backgroundColor: value, borderColor: value, width: size, height: size }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-5 gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className="h-6 w-6 rounded-full border flex items-center justify-center"
              style={{ backgroundColor: c, borderColor: c }}
              aria-label={c}
            >
              {value?.toLowerCase() === c.toLowerCase() && <Check className="h-3.5 w-3.5 text-white" />}
            </button>
          ))}
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className={cn("mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground")}
          >
            <RotateCcw className="h-3 w-3" /> Color por defecto
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
