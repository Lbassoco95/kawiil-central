import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TrendIndicatorProps {
  /** Valor actual. */
  current: number;
  /** Valor previo (mes anterior). */
  previous: number;
  /**
   * Si true, una caída se considera positiva (típico para gastos).
   * Default: false (subir es bueno, ej. ingresos).
   */
  invertGood?: boolean;
  /** Texto opcional al final, ej. "vs. mes anterior". */
  label?: string;
  className?: string;
}

function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

export function TrendIndicator({
  current,
  previous,
  invertGood = false,
  label = "vs. mes anterior",
  className,
}: TrendIndicatorProps) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-muted-foreground", className)}>
        <Minus className="h-3 w-3" />
        sin datos
      </span>
    );
  }

  if (previous === 0 && current === 0) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-muted-foreground", className)}>
        <Minus className="h-3 w-3" />
        sin cambio
      </span>
    );
  }

  const pct = previous === 0 ? Infinity : ((current - previous) / Math.abs(previous)) * 100;
  const isUp = current > previous;
  const isFlat = current === previous;
  const Icon = isFlat ? Minus : isUp ? ArrowUpRight : ArrowDownRight;
  const goodDirection = invertGood ? !isUp : isUp;
  const tone = isFlat
    ? "text-muted-foreground"
    : goodDirection
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";

  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium tabular-nums", tone, className)}>
      <Icon className="h-3 w-3" />
      <span>{previous === 0 ? (current > 0 ? "Nuevo" : "—") : fmtPct(pct)}</span>
      <span className="text-muted-foreground font-normal">{label}</span>
    </span>
  );
}
