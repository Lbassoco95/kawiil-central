import { useState, useCallback } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { nowMX, toDateStringMX } from "@/lib/dateUtils";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";

interface MetricInsightProps {
  metricKey: string;
  contextPrompt: string;
  ready: boolean;
  /**
   * Insight ya generado (p.ej. proveniente de `useAiModuleBriefing().metricInsights[metricKey]`).
   * Si se pasa, se renderiza directamente SIN llamar a IA. Prioritario.
   */
  insight?: string;
  /** Oculta el botón "Generar" cuando no hay insight. */
  hideManualTrigger?: boolean;
  /** (Legacy) Ya no se usa; se mantiene por compat con llamadas previas. */
  requestDelayMs?: number;
}

/**
 * MetricInsight — insight corto de IA asociado a una métrica del dashboard.
 *
 * **Cambio de política (B1.6 optimización costos)**: este componente YA NO dispara
 * IA automáticamente al montar. Opciones de uso:
 *   1) Recomendado: recibir `insight` desde el briefing del módulo padre
 *      (`useAiModuleBriefing().metricInsights[metricKey]`). 0 llamadas IA propias.
 *   2) Fallback: botón "Generar" que dispara IA on-demand y cachea 24 h en
 *      localStorage por `metricKey`.
 */
export function MetricInsight({
  metricKey,
  contextPrompt,
  ready,
  insight: externalInsight,
  hideManualTrigger = false,
}: MetricInsightProps) {
  const [localInsight, setLocalInsight] = useState<string | null>(() => {
    try {
      const cached = localStorage.getItem(`kawiil-insight-${metricKey}`);
      if (cached) {
        const { date, content } = JSON.parse(cached);
        if (date === toDateStringMX(nowMX())) return content;
      }
    } catch {
      /* cache no disponible */
    }
    return null;
  });
  const [loading, setLoading] = useState(false);

  const insight = externalInsight ?? localInsight;

  const generate = useCallback(async () => {
    if (!ready || loading) return;
    setLoading(true);
    try {
      const fullContent = await fetchAiChatSimpleContent(
        [{ role: "user", content: contextPrompt }],
        { retries: 2 },
      );
      if (fullContent) {
        setLocalInsight(fullContent);
        try {
          localStorage.setItem(
            `kawiil-insight-${metricKey}`,
            JSON.stringify({ date: toDateStringMX(nowMX()), content: fullContent }),
          );
        } catch {
          /* ignorar */
        }
      }
    } catch {
      /* fallo silencioso — es un insight secundario, no crítico */
    } finally {
      setLoading(false);
    }
  }, [contextPrompt, ready, metricKey, loading]);

  if (insight) {
    return (
      <div className="flex items-start gap-2 mt-2 w-full min-w-0">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-1" aria-hidden />
        <div className="min-w-0 flex-1 rounded-lg border border-border/50 bg-muted/15 px-3 py-2.5">
          <KawiilAiMarkdown variant="compact">{insight}</KawiilAiMarkdown>
          <div className="mt-1.5 flex justify-end">
            <AiFeedback surface="metric_insight" contextKey={aiFeedbackKey(insight)} label={null} />
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        <span>Analizando…</span>
      </div>
    );
  }

  if (hideManualTrigger || !ready) return null;

  return (
    <button
      type="button"
      onClick={() => void generate()}
      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground/70 hover:text-primary transition-colors"
      title="Generar insight con Kawiil AI"
    >
      <Sparkles className="h-3 w-3" />
      Generar insight
    </button>
  );
}
