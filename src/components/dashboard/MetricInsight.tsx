import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { nowMX, toDateStringMX } from "@/lib/dateUtils";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";

interface MetricInsightProps {
  metricKey: string;
  contextPrompt: string;
  ready: boolean;
  /** Espera antes de llamar a la IA (evita ráfagas 429 cuando hay varios widgets montados). */
  requestDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MetricInsight({ metricKey, contextPrompt, ready, requestDelayMs = 0 }: MetricInsightProps) {
  const [insight, setInsight] = useState<string | null>(() => {
    try {
      const cached = localStorage.getItem(`kawiil-insight-${metricKey}`);
      if (cached) {
        const { date, content } = JSON.parse(cached);
        if (date === toDateStringMX(nowMX())) return content;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(false);
  const attempted = useRef(false);

  const generate = useCallback(async () => {
    if (!ready || loading) return;
    setLoading(true);

    try {
      if (requestDelayMs > 0) await sleep(requestDelayMs);
      const fullContent = await fetchAiChatSimpleContent(
        [{ role: "user", content: contextPrompt }],
        { retries: 2 },
      );
      if (fullContent) {
        setInsight(fullContent);
        try {
          localStorage.setItem(
            `kawiil-insight-${metricKey}`,
            JSON.stringify({ date: toDateStringMX(nowMX()), content: fullContent })
          );
        } catch {}
      }
    } catch {
      // Silent fail for metric insights
    } finally {
      setLoading(false);
    }
  }, [contextPrompt, ready, metricKey, loading, requestDelayMs]);

  useEffect(() => {
    if (ready && !insight && !loading && !attempted.current) {
      attempted.current = true;
      generate();
    }
  }, [ready, insight]);

  if (!insight && !loading) return null;

  return (
    <div className="flex items-start gap-2 mt-2 w-full min-w-0">
      {loading ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>Analizando…</span>
        </div>
      ) : insight ? (
        <>
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-1" aria-hidden />
          <div className="min-w-0 flex-1 rounded-lg border border-border/50 bg-muted/15 px-3 py-2.5">
            <KawiilAiMarkdown variant="compact">{insight}</KawiilAiMarkdown>
          </div>
        </>
      ) : null}
    </div>
  );
}