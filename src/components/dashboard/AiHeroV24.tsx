import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Quote,
  CalendarPlus,
  BarChart3,
  Ban,
  LayoutGrid,
  AlertTriangle,
  Scale,
  FileText,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { getMexicoTimeSlot } from "@/lib/dateUtils";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import {
  useAiModuleBriefing,
  sha256Hex,
  type AiModuleBriefingModule,
} from "@/hooks/useAiModuleBriefing";
import type { AiChatSimpleMessage } from "@/lib/fetchAiChatSimple";

const PHRASE_FALLBACK =
  "La mejor manera de predecir el futuro es creándolo.\n— Peter Drucker, Managing for Results";

function splitPhrase(raw: string): { quote: string; author: string | null } {
  const lines = (raw || PHRASE_FALLBACK)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 2 && /^[—-]/.test(lines[lines.length - 1])) {
    const author = lines[lines.length - 1].replace(/^[—-]\s*/, "");
    const quote = lines.slice(0, -1).join(" ").replace(/^["“]|["”]$/g, "");
    return { quote, author };
  }
  return { quote: raw, author: null };
}

export interface TareasV24Context {
  tasksCount: number;
  completedToday: number;
  overdueCount: number;
  dueThisWeekCount: number;
  blockedCount?: number;
  /** Array corto (≤8) con tareas críticas hoy: {title, client, dueInDays, priority}. */
  topCritical?: Array<{
    id: string;
    title: string;
    client?: string | null;
    dueInDays?: number | null;
    priority?: string | null;
  }>;
  onArmaMiDia?: () => void;
  onResumenSemana?: () => void;
  onQueMeBloquea?: () => void;
}

export interface ProyectosV24Context {
  activos: number;
  enRiesgo: number;
  sinActividad: number;
  total: number;
  /** Array corto con proyectos en riesgo (top 8). */
  topRisk?: Array<{
    id: string;
    name: string;
    client?: string | null;
    criticality?: string | null;
    delay?: string | null;
    progressPct?: number | null;
  }>;
  onSeeRisks?: () => void;
  onRebalance?: () => void;
  onReport?: () => void;
}

type AiHeroV24Props =
  | ({ module: "tareas"; ctx: TareasV24Context } & SharedProps)
  | ({ module: "proyectos"; ctx: ProyectosV24Context } & SharedProps);

interface SharedProps {
  /** True cuando los datos están listos para generar el briefing. */
  ready?: boolean;
  className?: string;
  /** Si true, oculta la columna derecha (frase del día). */
  hideQuote?: boolean;
}

/**
 * Hero IA versión v2.4: .ai-hero-grid .ai-hero-compact con card briefing (.ai-brief)
 * + card frase (.ai-quote). Diseñado para envolverse dentro de un `.kwv24` container.
 */
export function AiHeroV24(props: AiHeroV24Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = useMexicoToday();

  const { timeOfDay, checkDate: todayYmd } = useMemo(
    () => getMexicoTimeSlot(today),
    [today],
  );

  const hideQuote = props.hideQuote ?? false;
  const ready = props.ready ?? true;

  // Briefing: hash + messages según módulo.
  const { messages, payload } = useMemo(
    () => buildBriefingInput(props),
    [props],
  );

  const [payloadHash, setPayloadHash] = useState<string>("");
  useEffect(() => {
    void sha256Hex(JSON.stringify(payload)).then(setPayloadHash);
  }, [payload]);

  const briefing = useAiModuleBriefing({
    module: props.module as AiModuleBriefingModule,
    payloadHash,
    buildMessages: () => messages,
    enabled: ready && !!payloadHash,
  });

  // Frase del día.
  const phraseQuery = useQuery({
    queryKey: ["ai-hero-v24-phrase", props.module, user?.id, todayYmd, timeOfDay],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-phrase", {
        body: {
          module: props.module,
          time_of_day: timeOfDay,
        },
      });
      if (error) throw error;
      const payload = data as { phrase?: string } | null;
      return payload?.phrase || PHRASE_FALLBACK;
    },
    enabled: !!user && !hideQuote,
    staleTime: 8 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const phrase = splitPhrase(phraseQuery.data || PHRASE_FALLBACK);

  const goToAssistant = (prompt: string) => {
    navigate(`/asistente?prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className={`ai-hero-grid ai-hero-compact ${props.className ?? ""}`}>
      <div className="ai-hero-card ai-brief">
        <div className="ai-hero-eyebrow">
          {props.module === "proyectos" ? (
            <LayoutGrid width={12} height={12} />
          ) : (
            <Sparkles width={12} height={12} />
          )}
          {props.module === "proyectos" ? "Briefing · tus proyectos" : "Briefing · tus tareas"}
          {briefing.isRefreshing ? (
            <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted-foreground" />
          ) : briefing.content ? (
            <button
              type="button"
              onClick={() => void briefing.regenerate()}
              className="ml-1 inline-flex text-muted-foreground transition-colors hover:text-foreground"
              title="Regenerar briefing"
              aria-label="Regenerar briefing"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        <div className="ai-hero-brief-body">
          {briefing.isLoading && !briefing.content ? (
            <span className="text-xs text-muted-foreground">
              Generando briefing…
            </span>
          ) : briefing.error && !briefing.content ? (
            <span className="text-xs text-destructive">
              {briefing.error.message}
            </span>
          ) : briefing.content ? (
            <KawiilAiMarkdown className="text-[12.5px] leading-relaxed">
              {briefing.content}
            </KawiilAiMarkdown>
          ) : (
            <span className="text-xs text-muted-foreground">
              {props.module === "proyectos"
                ? "Analizando tu cartera de proyectos…"
                : "Analizando tus tareas…"}
            </span>
          )}
        </div>

        <div className="ai-chips">
          {props.module === "tareas" ? (
            <>
              <button
                type="button"
                className="ai-chip"
                onClick={() =>
                  props.ctx.onArmaMiDia
                    ? props.ctx.onArmaMiDia()
                    : goToAssistant(
                        "Arma mi día con base en mis tareas pendientes, vencimientos y prioridades. Sugiere bloques de tiempo realistas.",
                      )
                }
              >
                <CalendarPlus className="h-3 w-3" />
                Arma mi día
              </button>
              <button
                type="button"
                className="ai-chip"
                onClick={() =>
                  props.ctx.onResumenSemana
                    ? props.ctx.onResumenSemana()
                    : goToAssistant(
                        "Dame un resumen de cómo voy esta semana: avances, tareas completadas, pendientes críticos y proyectos en riesgo.",
                      )
                }
              >
                <BarChart3 className="h-3 w-3" />
                Resumen semana
              </button>
              <button
                type="button"
                className="ai-chip"
                onClick={() =>
                  props.ctx.onQueMeBloquea
                    ? props.ctx.onQueMeBloquea()
                    : goToAssistant(
                        "¿Qué tareas o proyectos tengo bloqueados o en espera de terceros? Dame una lista priorizada con próximas acciones.",
                      )
                }
              >
                <Ban className="h-3 w-3" />
                ¿Qué me bloquea?
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ai-chip"
                onClick={() =>
                  props.ctx.onSeeRisks
                    ? props.ctx.onSeeRisks()
                    : goToAssistant(
                        "Lista los proyectos de mi despacho que están en riesgo (crítico o retrasado), por qué y la próxima acción concreta para cada uno.",
                      )
                }
              >
                <AlertTriangle className="h-3 w-3" />
                Ver riesgos
              </button>
              <button
                type="button"
                className="ai-chip"
                onClick={() =>
                  props.ctx.onRebalance
                    ? props.ctx.onRebalance()
                    : goToAssistant(
                        "Rebalancea la carga de mis proyectos: qué proyectos puedo despriorizar o reasignar para liberar tiempo en los críticos.",
                      )
                }
              >
                <Scale className="h-3 w-3" />
                Rebalancear
              </button>
              <button
                type="button"
                className="ai-chip"
                onClick={() =>
                  props.ctx.onReport
                    ? props.ctx.onReport()
                    : goToAssistant(
                        "Genera un reporte ejecutivo de mis proyectos activos: avance, riesgos, próximos hitos y bloqueos.",
                      )
                }
              >
                <FileText className="h-3 w-3" />
                Reporte
              </button>
            </>
          )}
        </div>
      </div>

      {!hideQuote && (
        <div className="ai-hero-card ai-quote">
          <div className="ai-hero-eyebrow">
            <Quote width={12} height={12} />
            {props.module === "proyectos" ? "Tu frase · proyectos" : "Tu frase · enfoque"}
          </div>
          <blockquote className="ai-quote-text">
            «{phrase.quote.replace(/^[«"]|[»"]$/g, "").trim()}»
          </blockquote>
          <div className="ai-quote-foot">
            <span className="truncate">
              {phrase.author ? `— ${phrase.author}` : "Curada para ti"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function buildBriefingInput(props: AiHeroV24Props): {
  messages: AiChatSimpleMessage[];
  payload: unknown;
} {
  if (props.module === "tareas") {
    const { ctx } = props;
    const topList = (ctx.topCritical ?? [])
      .slice(0, 8)
      .map((t) => {
        const parts = [t.title];
        if (t.client) parts.push(`cliente ${t.client}`);
        if (typeof t.dueInDays === "number") {
          if (t.dueInDays < 0) parts.push(`${Math.abs(t.dueInDays)}d vencida`);
          else if (t.dueInDays === 0) parts.push("vence hoy");
          else parts.push(`vence en ${t.dueInDays}d`);
        }
        if (t.priority) parts.push(`prioridad ${t.priority}`);
        return `- ${parts.join(" · ")}`;
      })
      .join("\n");

    const prompt = [
      "Eres un copiloto operativo de un despacho fiscal/legal. Genera un BRIEFING ULTRA CORTO (máximo 2 párrafos cortos, sin listas, sin saludos).",
      "Tono directo, ejecutivo, español de México. NO repitas conteos ya visibles, NO inventes datos.",
      "",
      "Contexto:",
      `- Tareas abiertas: ${ctx.tasksCount}`,
      `- Completadas hoy: ${ctx.completedToday}`,
      `- Vencidas: ${ctx.overdueCount}`,
      `- Vencen esta semana (≤7 días): ${ctx.dueThisWeekCount}`,
      typeof ctx.blockedCount === "number" ? `- Bloqueadas: ${ctx.blockedCount}` : "",
      topList ? `\nTareas críticas (top):\n${topList}` : "",
      "",
      "Estructura: 1) qué tarea(s) atender PRIMERO y por qué (con nombre concreto), 2) si aplica, una sugerencia para delegar o aplazar algo. Si todo está bien, sugiere una mejora marginal.",
    ]
      .filter(Boolean)
      .join("\n");

    const payload = {
      v: 1,
      module: "tareas",
      tasksCount: ctx.tasksCount,
      completedToday: ctx.completedToday,
      overdueCount: ctx.overdueCount,
      dueThisWeek: ctx.dueThisWeekCount,
      blocked: ctx.blockedCount ?? 0,
      topIds: (ctx.topCritical ?? []).slice(0, 8).map((t) => t.id),
    };

    return {
      messages: [{ role: "user", content: prompt }],
      payload,
    };
  }

  // proyectos
  const { ctx } = props;
  const topList = (ctx.topRisk ?? [])
    .slice(0, 8)
    .map((p) => {
      const parts = [p.name];
      if (p.client) parts.push(`cliente ${p.client}`);
      if (p.criticality === "critico") parts.push("CRÍTICO");
      if (p.delay === "retrasado") parts.push("RETRASADO");
      if (typeof p.progressPct === "number") parts.push(`${Math.round(p.progressPct)}% avance`);
      return `- ${parts.join(" · ")}`;
    })
    .join("\n");

  const prompt = [
    "Eres un copiloto operativo de un despacho fiscal/legal. Genera un BRIEFING ULTRA CORTO (máximo 2 párrafos cortos, sin listas, sin saludos).",
    "Tono directo, ejecutivo, español de México. NO repitas conteos ya visibles, NO inventes datos.",
    "",
    "Contexto:",
    `- Proyectos activos: ${ctx.activos}`,
    `- En riesgo (crítico o retrasado): ${ctx.enRiesgo}`,
    `- Sin actividad ≥ 7 días: ${ctx.sinActividad}`,
    topList ? `\nProyectos en riesgo (top):\n${topList}` : "",
    "",
    "Estructura: 1) qué proyecto(s) atender PRIMERO y por qué (con nombre concreto), 2) si aplica, una oportunidad de adelantar otro proyecto. Si todo está bien, dilo y sugiere una mejora marginal.",
  ].join("\n");

  const payload = {
    v: 1,
    module: "proyectos",
    activos: ctx.activos,
    enRiesgo: ctx.enRiesgo,
    sinActividad: ctx.sinActividad,
    total: ctx.total,
    topIds: (ctx.topRisk ?? []).slice(0, 8).map((p) => p.id),
  };

  return {
    messages: [{ role: "user", content: prompt }],
    payload,
  };
}
