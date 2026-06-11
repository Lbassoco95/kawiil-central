import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile, getFirstName, getGreeting } from "@/hooks/useCurrentProfile";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { DailyBriefing } from "@/components/dashboard/DailyBriefing";
import { MoodCheckin } from "@/components/dashboard/MoodCheckin";
import {
  Sparkles,
  Quote,
  CalendarPlus,
  BarChart3,
  Ban,
  Users as UsersIcon,
  AlertTriangle,
  ListChecks,
  Download as DownloadIcon,
} from "lucide-react";
// La "frase del día" solo aplica al dashboard personal (tareas).
// En módulos como Clientes mostramos únicamente el briefing operativo.
import { cn } from "@/lib/utils";
import { getMexicoTimeSlot } from "@/lib/dateUtils";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

export type AiHeroModule = "tareas" | "clientes";

export interface AiHeroClientesContext {
  activos: number | null;
  alCorriente: number | null;
  requierenAtencion: number | null;
  onboarding: number | null;
  attentionList?: Array<{ id: string; name: string; reason: string }>;
  onSeeAlerts?: () => void;
  onPrioritize?: () => void;
  onExport?: () => void;
}

interface AiHeroGridProps {
  /** Módulo del que se muestra el briefing/frase. Default `tareas` para retrocompat. */
  module?: AiHeroModule;
  className?: string;
  /** Requerido en `module="tareas"` (variante mood checkin habilitada). */
  userCelula?: string | null;
  /** Requeridos en `module="tareas"`. */
  tasksCount?: number;
  completedToday?: number;
  overdueCount?: number;
  remindersCount?: number;
  /** Requerido en `module="clientes"`. */
  clientes?: AiHeroClientesContext;
  /** Mostrar la card derecha con la "frase de hoy". Default `true` para `tareas`. */
  showQuote?: boolean;
  /** Mostrar el bloque MoodCheckin debajo de la frase. Default `true` para `tareas`. */
  showMoodCheckin?: boolean;
}

const PHRASE_FALLBACK =
  "La mejor manera de predecir el futuro es creándolo.\n— Peter Drucker, Managing for Results";

function stripMarkdown(text: string): string {
  return text
    .replace(/^FRASE:\s*/i, "")                      // remove leading FRASE: prefix
    .replace(/\n\s*---[\s\S]*/g, "")                 // cut everything after --- separator
    .replace(/\nConecta con:[^\n]*/gi, "")           // remove Conecta con: lines
    .replace(/\nConfianza:[^\n]*/gi, "")             // remove Confianza: lines
    .replace(/\*\*([^*]+)\*\*/g, "$1")               // **bold** → text
    .replace(/\*([^*]+)\*/g, "$1")                   // *italic* → text
    .replace(/_([^_]+)_/g, "$1")                     // _italic_ → text
    .trim();
}

function splitPhrase(raw: string, fallback: string): { quote: string; author: string | null } {
  if (!raw) {
    const lines = fallback.split(/\n+/);
    return {
      quote: lines[0] ?? fallback,
      author: lines[1]?.replace(/^[—-]\s*/, "") ?? null,
    };
  }
  const cleaned = stripMarkdown(raw);
  const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && /^[—-]/.test(lines[lines.length - 1])) {
    const author = lines[lines.length - 1].replace(/^[—-]\s*/, "");
    const quote = lines.slice(0, -1).join(" ").replace(/^["\u201C\u00AB]|["\u201D\u00BB]$/g, "");
    return { quote, author };
  }
  return { quote: cleaned, author: null };
}

export function AiHeroGrid({
  module = "tareas",
  className,
  userCelula,
  tasksCount = 0,
  completedToday = 0,
  overdueCount = 0,
  remindersCount = 0,
  clientes,
  showQuote = true,
  showMoodCheckin = true,
}: AiHeroGridProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profile } = useCurrentProfile();
  const today = useMexicoToday();

  const firstName = getFirstName(profile, user?.email);
  const greeting = useMemo(() => getGreeting(today), [today]);

  const eyebrowDate = today
    .toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" })
    .replace(/\./g, "");
  const isClientes = module === "clientes";
  const eyebrow = isClientes ? "Briefing · tu cartera" : `Briefing · ${eyebrowDate}`;

  // Recalcular slot al actualizarse `today` (cada minuto / al volver a la pestaña).
  // Misma regla que `MoodCheckin` para evitar desalineación entre frase y mood.
  const { timeOfDay, checkDate: todayYmd } = useMemo(() => getMexicoTimeSlot(today), [today]);

  const { data: todayMood } = useQuery({
    queryKey: ["ai-hero-mood", user?.id, todayYmd, timeOfDay],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mood_checkins" as any)
        .select("mood")
        .eq("user_id", user!.id)
        .eq("check_date", todayYmd)
        .eq("time_of_day", timeOfDay)
        .maybeSingle();
      if (error) throw error;
      return (data as { mood?: number } | null)?.mood ?? null;
    },
    enabled: !!user && !isClientes,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const phraseBody = useMemo(
    () => ({
      module: "tareas" as const,
      time_of_day: timeOfDay,
      mood_score: todayMood ?? null,
      tasks_pending: tasksCount,
      completed_today: completedToday,
      overdue_count: overdueCount,
    }),
    [timeOfDay, todayMood, tasksCount, completedToday, overdueCount],
  );

  const phraseQuery = useQuery({
    queryKey: ["ai-hero-phrase", "tareas", user?.id, todayYmd, timeOfDay],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-phrase", {
        body: phraseBody,
      });
      if (error) throw error;
      const payload = data as { phrase?: string } | null;
      return payload?.phrase || PHRASE_FALLBACK;
    },
    enabled: !!user && !isClientes,
    staleTime: 8 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const goToAssistant = useCallback(
    (prompt: string) => {
      navigate(`/asistente?prompt=${encodeURIComponent(prompt)}`);
    },
    [navigate],
  );

  const phrase = splitPhrase(phraseQuery.data || PHRASE_FALLBACK, PHRASE_FALLBACK);
  const showRightColumn = !isClientes && (showQuote || showMoodCheckin);

  return (
    <div
      className={cn(
        "kw-ai-hero-grid",
        (isClientes || !showRightColumn) && "kw-ai-hero-grid--brief-only",
        className,
      )}
    >
      <div className="kw-ai-card kw-ai-brief">
        <div className="kw-ai-eyebrow flex items-center gap-2">
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm ring-1 ring-white/20"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            {isClientes ? <UsersIcon className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
          </span>
          <span className="capitalize">{eyebrow}</span>
          <span className="ml-1 rounded-full border border-sky-300/70 bg-sky-50/70 px-1.5 py-[1px] text-[9.5px] font-semibold tracking-wider text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300">
            KAWIIL AI · v2.4
          </span>
        </div>

        {isClientes ? (
          <ClientesBrief clientes={clientes} firstName={firstName} />
        ) : (
          <>
            <div className="kw-ai-greet">
              {greeting}, {firstName} <span className="kw-ai-wave">👋</span>
            </div>
            <div className="kw-ai-brief-body">
              <DailyBriefing
                tasksCount={tasksCount}
                completedToday={completedToday}
                overdueCount={overdueCount}
                remindersCount={remindersCount}
                variant="compact"
                hideHeader
              />
            </div>
          </>
        )}

        <div className="kw-ai-chips">
          {isClientes ? (
            <>
              <button
                type="button"
                className="kw-ai-chip"
                onClick={() =>
                  clientes?.onSeeAlerts
                    ? clientes.onSeeAlerts()
                    : goToAssistant(
                        "Lista los clientes de mi cartera que requieren atención hoy: tareas vencidas, contactos sin actividad reciente, CSF/32-D próximas a vencer.",
                      )
                }
              >
                <AlertTriangle className="h-3 w-3" />
                Ver alertas
              </button>
              <button
                type="button"
                className="kw-ai-chip"
                onClick={() =>
                  clientes?.onPrioritize
                    ? clientes.onPrioritize()
                    : goToAssistant(
                        "Priorizame los clientes de mi cartera por riesgo y urgencia, dame las próximas acciones para los 5 más críticos.",
                      )
                }
              >
                <ListChecks className="h-3 w-3" />
                Priorizar
              </button>
              <button
                type="button"
                className="kw-ai-chip"
                onClick={() => clientes?.onExport?.()}
                disabled={!clientes?.onExport}
              >
                <DownloadIcon className="h-3 w-3" />
                Exportar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="kw-ai-chip"
                onClick={() =>
                  goToAssistant(
                    "Arma mi día con base en mis tareas pendientes, vencimientos y prioridades. Sugiere bloques de tiempo realistas.",
                  )
                }
              >
                <CalendarPlus className="h-3 w-3" />
                Arma mi día
              </button>
              <button
                type="button"
                className="kw-ai-chip"
                onClick={() =>
                  goToAssistant(
                    "Dame un resumen de cómo voy esta semana: avances, tareas completadas, pendientes críticos y proyectos en riesgo.",
                  )
                }
              >
                <BarChart3 className="h-3 w-3" />
                Resumen semana
              </button>
              <button
                type="button"
                className="kw-ai-chip"
                onClick={() =>
                  goToAssistant(
                    "¿Qué tareas o proyectos tengo bloqueados o en espera de terceros? Dame una lista priorizada con próximas acciones.",
                  )
                }
              >
                <Ban className="h-3 w-3" />
                ¿Qué me bloquea?
              </button>
            </>
          )}
        </div>
      </div>

      {showRightColumn && (
        <div className="kw-ai-right">
          {showQuote && (
            <div className="kw-ai-card kw-ai-quote">
              <div className="kw-ai-eyebrow kw-ai-eyebrow-accent">
                <Quote className="h-3 w-3" />
                <span>Tu frase de hoy</span>
              </div>
              <blockquote className="kw-ai-quote-text">
                «{phrase.quote.replace(/^[«"]|[»"]$/g, "").trim()}»
              </blockquote>
              <div className="kw-ai-quote-foot">
                <span className="truncate">{phrase.author ? `— ${phrase.author}` : "Curada para ti"}</span>
              </div>
            </div>
          )}

          {showMoodCheckin && (
            <div className="kw-ai-mood">
              <MoodCheckin userCelula={userCelula ?? null} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClientesBrief({
  clientes,
  firstName,
}: {
  clientes?: AiHeroClientesContext;
  firstName: string;
}) {
  const list = clientes?.attentionList ?? [];
  const requieren = clientes?.requierenAtencion ?? 0;
  const onboarding = clientes?.onboarding ?? 0;
  const alCorriente = clientes?.alCorriente ?? null;

  return (
    <>
      <div className="kw-ai-greet">
        Tu cartera, {firstName}
      </div>
      <div className="kw-ai-brief-body">
        <p className="text-sm leading-relaxed">
          {requieren > 0 ? (
            <>
              <strong>{requieren} cliente{requieren === 1 ? "" : "s"} requiere{requieren === 1 ? "" : "n"} atención</strong>
              {list.length > 0 ? (
                <>
                  : {list.slice(0, 4).map((c, i) => (
                    <span key={c.id}>
                      {i > 0 ? ", " : " "}
                      <strong>{c.name}</strong>
                      <span className="text-muted-foreground"> ({c.reason})</span>
                    </span>
                  ))}
                  .
                </>
              ) : (
                "."
              )}{" "}
            </>
          ) : alCorriente != null ? (
            <>
              <strong>Toda tu cartera está al corriente</strong> ({alCorriente} cliente{alCorriente === 1 ? "" : "s"} sin alertas).{" "}
            </>
          ) : null}
          {onboarding > 0 ? (
            <>
              <strong>{onboarding} alta{onboarding === 1 ? "" : "s"} nueva{onboarding === 1 ? "" : "s"}</strong> pendiente{onboarding === 1 ? "" : "s"} de onboarding este mes.
            </>
          ) : null}
        </p>
      </div>
    </>
  );
}
