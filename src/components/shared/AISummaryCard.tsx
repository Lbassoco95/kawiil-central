import { useState, useCallback, useEffect } from "react";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { nowMX, toDateStringMX } from "@/lib/dateUtils";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";

interface Props {
  cacheKey: string;
  contextPrompt: string;
  title?: string;
  ready: boolean;
  userId?: string;
  accentClass?: string;
  /** Espera antes de llamar a la IA (escalonar con otros widgets del dashboard). */
  requestDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AISummaryCard({
  cacheKey,
  contextPrompt,
  title = "Resumen Kawiil AI",
  ready,
  userId,
  requestDelayMs = 0,
}: Props) {
  const [content, setContent] = useState<string | null>(() => {
    try {
      const cached = localStorage.getItem(`kawiil-summary-${cacheKey}`);
      if (cached) {
        const { date, content: c } = JSON.parse(cached);
        if (date === toDateStringMX(nowMX())) return c;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const generate = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    setExpanded(true);

    try {
      const fullContent = await fetchAiChatSimpleContent(
        [{ role: "user", content: contextPrompt }],
        { retries: 2 },
      );
      if (fullContent) {
        setContent(fullContent);
        try {
          localStorage.setItem(
            `kawiil-summary-${cacheKey}`,
            JSON.stringify({ date: toDateStringMX(nowMX()), content: fullContent })
          );
        } catch {}
      }
    } catch (err: any) {
      setError(err.message || "Error al generar resumen");
    } finally {
      setLoading(false);
    }
  }, [contextPrompt, ready, cacheKey, requestDelayMs]);

  // Auto-generate on mount if no cached content
  useEffect(() => {
    if (ready && !content && !loading) {
      generate();
    }
  }, [ready, content]);

  return (
    <section>
      <div className="flex items-center gap-2">
        <button
          onClick={() => content ? setExpanded(!expanded) : generate()}
          className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>{title}</span>
        </button>
        {content && (
          <button
            onClick={generate}
            disabled={loading || !ready}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pl-7">
          {error && (
            <p className="text-xs text-destructive mb-2">{error}</p>
          )}

          {content ? (
            <KawiilAiMarkdown className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
              {content}
            </KawiilAiMarkdown>
          ) : loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analizando datos...
            </div>
          ) : (
            <button
              onClick={generate}
              disabled={!ready}
              className="text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              Generar resumen
            </button>
          )}
        </div>
      )}
    </section>
  );
}
