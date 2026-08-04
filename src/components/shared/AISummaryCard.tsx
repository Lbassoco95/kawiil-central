import { useState, useCallback, useEffect } from "react";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";
import { nowMX, toDateStringMX } from "@/lib/dateUtils";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";
import { Badge } from "@/components/ui/badge";
import {
  KAWIIL_AI_GRADIENT,
  KAWIIL_AI_HEADER_BG,
} from "@/lib/kawiilAi";

interface Props {
  cacheKey: string;
  contextPrompt: string;
  title?: string;
  /** Subtítulo opcional bajo el título (eyebrow). Default según contexto. */
  subtitle?: string;
  ready: boolean;
  userId?: string;
  accentClass?: string;
  /**
   * Contenido ya generado (p.ej. desde `useAiModuleBriefing().content` del módulo padre).
   * Si se pasa, se renderiza directamente SIN llamar a IA. Tiene prioridad sobre el cache local.
   */
  externalContent?: string;
  /** Espera antes de llamar a la IA (escalonar con otros widgets del dashboard). */
  requestDelayMs?: number;
}

/**
 * AISummaryCard — resumen IA por módulo/KPI.
 *
 * **Cambio de política (B1.6 optimización costos)**: ya NO dispara IA al montar.
 * Dos modos de uso:
 *   1) Recomendado: el padre pasa `externalContent` desde el briefing del módulo
 *      (`useAiModuleBriefing().content`). 0 llamadas IA propias.
 *   2) On-demand: el usuario pulsa el botón "Generar resumen". Se cachea 24 h en
 *      localStorage por `cacheKey`.
 */
export function AISummaryCard({
  cacheKey,
  contextPrompt,
  title = "Resumen Kawiil AI",
  subtitle = "Analizado con tus datos en vivo",
  ready,
  userId,
  externalContent,
  requestDelayMs = 0,
}: Props) {
  void userId;
  void requestDelayMs;
  const [localContent, setLocalContent] = useState<string | null>(() => {
    try {
      const cached = localStorage.getItem(`kawiil-summary-${cacheKey}`);
      if (cached) {
        const { date, content: c } = JSON.parse(cached);
        if (date === toDateStringMX(nowMX())) return c;
      }
    } catch {
      /* localStorage no disponible o JSON inválido: regenerar a demanda */
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // El contenido externo (del briefing del módulo padre) tiene prioridad sobre
  // el cache local. Si no hay externo, se usa el local (cache 24h en localStorage).
  const content = externalContent ?? localContent;

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
        setLocalContent(fullContent);
        try {
          localStorage.setItem(
            `kawiil-summary-${cacheKey}`,
            JSON.stringify({ date: toDateStringMX(nowMX()), content: fullContent }),
          );
        } catch {
          /* ignorar fallo de cache */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar resumen");
    } finally {
      setLoading(false);
    }
  }, [contextPrompt, ready, cacheKey]);

  // Si llega contenido externo, persistirlo en el cache local para aprovechar
  // entre navegaciones cuando el padre no esté montado.
  useEffect(() => {
    if (!externalContent) return;
    try {
      localStorage.setItem(
        `kawiil-summary-${cacheKey}`,
        JSON.stringify({ date: toDateStringMX(nowMX()), content: externalContent }),
      );
    } catch {
      /* ignorar */
    }
  }, [externalContent, cacheKey]);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-sky-200/70 shadow-sm dark:border-sky-800/40"
      aria-label={title}
    >
      <div
        className="flex items-center justify-between gap-3 border-b border-sky-200/40 px-4 py-2.5 dark:border-sky-800/30"
        style={{ background: KAWIIL_AI_HEADER_BG }}
      >
        <button
          type="button"
          onClick={() => (content ? setExpanded((v) => !v) : void generate())}
          className="flex min-w-0 items-center gap-2.5 text-left"
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white shadow-sm"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold leading-tight tracking-tight text-foreground">
              <span className="truncate">{title}</span>
              <Badge
                variant="outline"
                className="ml-0.5 h-4 border-sky-300/70 bg-sky-50/70 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
            </span>
            <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-muted-foreground">
              {subtitle}
            </span>
          </span>
          <span className="ml-1 shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        </button>
        {content ? (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading || !ready}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/60 hover:text-foreground disabled:opacity-50 dark:hover:bg-white/10"
            title="Regenerar resumen con Kawiil AI"
            aria-label="Regenerar resumen"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>

      {expanded && (
        <div className="bg-gradient-to-br from-sky-50/60 via-white to-blue-50/30 px-4 py-3 dark:from-sky-950/15 dark:via-card dark:to-blue-950/10">
          {error && (
            <p className="mb-2 text-xs text-destructive">{error}</p>
          )}

          {content ? (
            <>
              <KawiilAiMarkdown className="text-[13px] leading-relaxed">
                {content}
              </KawiilAiMarkdown>
              <div className="mt-2 flex justify-end">
                <AiFeedback
                  surface={`summary_${cacheKey}`}
                  contextKey={aiFeedbackKey(content)}
                />
              </div>
            </>
          ) : loading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
              Kawiil AI está analizando tus datos…
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!ready}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              style={{ background: KAWIIL_AI_GRADIENT }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generar resumen
            </button>
          )}
        </div>
      )}
    </section>
  );
}
