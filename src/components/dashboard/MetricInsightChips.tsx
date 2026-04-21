import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricInsightChipsProps {
  /** Insights bundleados por el briefing del módulo (key -> frase). */
  insights: Record<string, string>;
  /**
   * Etiquetas humanas por clave. Si falta la clave en este mapa, se usa el key tal cual.
   */
  labels: Record<string, string>;
  /** Orden de renderizado; claves sin insight se omiten silenciosamente. */
  order?: string[];
  className?: string;
  /** Texto opcional que precede a los chips. Default: "Insights por KPI". */
  eyebrow?: string;
}

/**
 * Renderiza los `metric_insights` del briefing del módulo como chips compactos.
 * Se muestra SOLO si hay al menos 1 insight no vacío. No dispara IA: consume el
 * resultado que ya devolvió el briefing (JSON `{markdown, metric_insights}`).
 */
export function MetricInsightChips({
  insights,
  labels,
  order,
  className,
  eyebrow = "Insights por KPI",
}: MetricInsightChipsProps) {
  const keys = order ?? Object.keys(insights);
  const rows = keys
    .map((k) => ({ key: k, label: labels[k] ?? k, text: (insights[k] ?? "").trim() }))
    .filter((r) => r.text.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className={cn("mt-2 space-y-1.5", className)}>
      <div className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        <Sparkles className="h-3 w-3 text-primary/70" />
        <span>{eyebrow}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <div
            key={r.key}
            className="group inline-flex max-w-full items-start gap-1.5 rounded-md border border-primary/15 bg-primary/5 px-2 py-1 text-[11px] leading-snug text-foreground/85"
            title={r.text}
          >
            <span className="shrink-0 font-semibold text-primary/90">{r.label}:</span>
            <span className="truncate">{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
