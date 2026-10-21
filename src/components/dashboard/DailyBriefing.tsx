import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronRight, Check, CalendarClock } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { toDateStringMX, mexicoDayRangeISO, addDaysToYmd } from "@/lib/dateUtils";
import { useUpdateTask } from "@/hooks/useTasks";
import { toast } from "sonner";
import { useMeetingFollowUp } from "@/hooks/useMeetingFollowUp";
import { KawiilitoCompanion } from "@/components/dashboard/KawiilitoCompanion";
import { useAiModuleBriefing, sha256Hex, briefingJsonInstructions } from "@/hooks/useAiModuleBriefing";
import { MetricInsightChips } from "@/components/dashboard/MetricInsightChips";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";

const DASHBOARD_METRIC_LABELS: Record<string, string> = {
  tasks_pendientes: "Pendientes",
  completadas_hoy: "Completadas",
  vencidas: "Vencidas",
  recordatorios: "Recordatorios",
};

/**
 * KPIs del dashboard personal cuyos insights se bundlen en el briefing.
 * Estas claves son contratos entre el prompt del briefing y los componentes
 * consumidores (PersonalDashboard, TeamDashboard).
 */
export const DASHBOARD_METRIC_KEYS = [
  "tasks_pendientes",
  "completadas_hoy",
  "vencidas",
  "recordatorios",
] as const;

interface DailyBriefingProps {
  tasksCount: number;
  completedToday: number;
  overdueCount: number;
  remindersCount: number;
  /** "compact" reduces padding/typography for use inside hero grids */
  variant?: "default" | "compact";
  /** Hide the wrapper section header (when used inside another card with own eyebrow) */
  hideHeader?: boolean;
}

/**
 * Briefing IA del día (módulo `dashboard`). Usa `ai_module_briefings` en Supabase
 * en lugar de `localStorage`: invalidación por payload_hash y compartible entre
 * dispositivos del mismo usuario.
 */
export function DailyBriefing({
  tasksCount,
  completedToday,
  overdueCount,
  remindersCount,
  variant = "default",
  hideHeader = false,
}: DailyBriefingProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const updateTask = useUpdateTask();
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);
  const today = useMexicoToday();
  const todayKey = toDateStringMX(today);

  const { data: taskDetails } = useQuery({
    queryKey: ["briefing-tasks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, area, clients(name)")
        .eq("assigned_to", user!.id)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true })
        .limit(15);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: profile } = useQuery({
    queryKey: ["briefing-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, area")
        .eq("user_id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  // Tareas cerradas hoy: base de la retro de cierre.
  const { data: completedTitles, isLoading: completedLoading } = useQuery({
    queryKey: ["briefing-completed-today", user?.id, todayKey, completedToday],
    queryFn: async () => {
      const { start, endExclusive } = mexicoDayRangeISO(todayKey);
      const { data, error } = await supabase
        .from("tasks")
        .select("title, completed_at, updated_at")
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .gte("updated_at", start)
        .lt("updated_at", endExclusive)
        .limit(10);
      if (error) throw error;
      return (data ?? []).map((t) => t.title);
    },
    enabled: !!user,
  });

  const firstName = profile?.full_name?.split(" ")[0] || "Kawiiler";
  const { data: meetingFollowUp, isLoading: followUpLoading } = useMeetingFollowUp(todayKey, firstName);

  const ready = !!user && !!taskDetails && !completedLoading && !followUpLoading;
  // Mañana: apertura del día. Desde las 17:00 CDMX: retro de cierre para cerrar tareas.
  const phase: "manana" | "cierre" = today.getHours() >= 17 ? "cierre" : "manana";
  const todayStr = today.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const payload = useMemo(() => {
    const taskIds = (taskDetails ?? []).map((t, i) => `${i}:${t.title}:${t.due_date ?? ""}:${t.status}:${t.priority}`);
    return {
      v: 4,
      module: "dashboard",
      date: todayKey,
      phase,
      counts: { tasksCount, completedToday, overdueCount, remindersCount },
      tasks: taskIds,
      done: completedTitles ?? [],
      meetings: (meetingFollowUp?.mine ?? []).map((a) => `${a.id}:${a.status}`),
      meetingsUnowned: meetingFollowUp?.unownedCount ?? 0,
    };
  }, [
    taskDetails, todayKey, phase, tasksCount, completedToday, overdueCount, remindersCount,
    completedTitles, meetingFollowUp,
  ]);

  const [payloadHash, setPayloadHash] = useState<string>("");
  useEffect(() => {
    if (!ready) return;
    void sha256Hex(JSON.stringify(payload)).then(setPayloadHash);
  }, [payload, ready]);

  const briefing = useAiModuleBriefing({
    module: "dashboard",
    payloadHash,
    // Hero principal: 1 briefing automático al día, y se refresca solo cuando cambia la fase
    // (mañana → cierre, 17:00 CDMX) o los datos (mín. 30 min entre regeneraciones).
    autoFetch: true,
    refresh: { phase, minIntervalMinutes: 30 },
    enabled: ready && !!payloadHash,
    buildMessages: () => {
      const closing = phase === "cierre";
      const meetingsBlock =
        (meetingFollowUp?.mine.length ?? 0) > 0 || (meetingFollowUp?.unownedCount ?? 0) > 0
          ? `\n\nCOMPROMISOS DE JUNTAS (últimos 14 días) QUE AÚN NO SON TAREA — ${meetingFollowUp?.mine.length ?? 0} tuyos, ${meetingFollowUp?.unownedCount ?? 0} sin responsable en la organización: ${JSON.stringify((meetingFollowUp?.mine ?? []).map((a) => ({ compromiso: a.text, fecha: a.dueDate, estado: a.status === "proposed" ? "propuesto, sin confirmar" : "confirmado, sin proyecto/tarea", sinResponsable: a.unowned })))}`
          : "";
      const contextPrompt = `${
        closing
          ? `Genera la RETRO DE CIERRE del día para ${firstName}. Hoy es ${todayStr} y ya es hora de cerrar jornada.`
          : `Genera un briefing corto y motivador del día para ${firstName}. Hoy es ${todayStr}.`
      }

DATOS (cifras oficiales — úsalas para cualquier total): ${tasksCount} tareas pendientes en total, ${completedToday} completadas hoy, ${overdueCount} vencidas, ${remindersCount} recordatorios.

PRÓXIMAS TAREAS (solo una MUESTRA de las ${tasksCount} pendientes: las más próximas por vencer, asignadas a ${firstName}, ordenadas por fecha): ${JSON.stringify((taskDetails ?? []).map((t) => ({ titulo: t.title, prioridad: t.priority, vence: t.due_date, area: t.area, cliente: (t as unknown as { clients?: { name?: string } }).clients?.name ?? null, estado: t.status })))}

TAREAS COMPLETADAS HOY: ${JSON.stringify(completedTitles ?? [])}${meetingsBlock}

INSTRUCCIONES PARA "markdown":
${
  closing
    ? `1. Estructura: ✅ **Lo que cerraste hoy** (reconoce lo completado), 🔥 **Lo que queda abierto** (vencidas y las que vencían hoy: dile cuáles cerrar o mover a mañana) y 🗣️ **Juntas** (si hay compromisos de juntas sin tarea, pídele convertirlos en tarea con proyecto, fecha y responsable).
2. Termina con UNA acción concreta para mañana.`
    : `1. Resume en máximo 3 puntos clave con emojis.
2. Si hay compromisos de juntas sin convertir en tarea, menciónalo como un punto clave y di cuántos son.`
}
3. Al nombrar tareas, fechas, clientes o compromisos usa ÚNICAMENTE los de los bloques de DATOS de arriba; NO inventes ninguno que no esté ahí.
4. Para cualquier TOTAL de pendientes usa la cifra de DATOS (${tasksCount}); NUNCA cuentes las filas de la muestra — es solo un extracto de las más próximas, no el total.
5. Si hay vencidas, menciona con empatía. Si completó, reconoce.
6. Máximo ${closing ? 110 : 80} palabras. Sé ultra-conciso.
7. Markdown obligatorio: línea de título con emoji (ej. ${closing ? "🌙 **Retro del …**" : "🗒️ **Briefing del …**"}), subtítulo **${closing ? "Cierre del día" : "Situación actual"}**, viñetas con emojis (🔥 ⚠️ ✅), **negritas** en cifras y alertas. Sin saludo largo.

INSTRUCCIONES PARA "metric_insights":
- tasks_pendientes: 1 frase sobre la carga de tareas pendientes (usa el total ${tasksCount}, no el tamaño de la muestra) y el siguiente foco.
- completadas_hoy: 1 frase que reconozca el avance o anime a avanzar si es 0.
- vencidas: 1 frase concreta con la acción para retomar si hay vencidas; si es 0, omite la clave.
- recordatorios: 1 frase útil sobre el estado de los recordatorios; si es 0, omite la clave.${briefingJsonInstructions({ metricKeys: [...DASHBOARD_METRIC_KEYS] })}`;
      return [{ role: "user", content: contextPrompt }];
    },
  });

  // Tareas para cerrar hoy: vencen hoy o ya vencidas (la consulta viene ordenada por fecha).
  const dueNow = useMemo(
    () => (taskDetails ?? []).filter((t) => t.due_date && t.due_date.slice(0, 10) <= todayKey).slice(0, 5),
    [taskDetails, todayKey],
  );

  const closeTask = (id: string, title: string, action: "done" | "tomorrow") => {
    setBusyIds((ids) => [...ids, id]);
    const updates =
      action === "done"
        ? { id, status: "completada" }
        : { id, due_date: addDaysToYmd(todayKey, 1) };
    updateTask.mutate(updates, {
      onSuccess: () => {
        toast.success(action === "done" ? `«${title}» completada` : `«${title}» movida a mañana`);
        for (const key of ["briefing-tasks", "briefing-completed-today", "personal-completed-today"]) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      },
      onSettled: () => setBusyIds((ids) => ids.filter((x) => x !== id)),
    });
  };

  const isCompact = variant === "compact";
  const loading = briefing.isLoading || briefing.isRefreshing;
  const content = briefing.content;
  const error = briefing.error;

  return (
    <section>
      {!hideHeader && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Briefing del día</span>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
        </button>
      )}

      {(hideHeader || expanded) && (
        <div className={hideHeader ? "" : "mt-3 pl-7"}>
          {loading && !content && (
            <p className={isCompact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
              Generando...
            </p>
          )}

          {error && !content && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 space-y-2">
              <p className="text-sm text-destructive">
                No se pudo generar el briefing. Intenta de nuevo.
              </p>
              <button
                type="button"
                onClick={() => void briefing.regenerate()}
                className="text-xs font-medium text-primary hover:underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {content && <KawiilAiMarkdown>{content}</KawiilAiMarkdown>}

          {content && (
            <div className="mt-2 flex justify-end">
              <AiFeedback surface="daily_briefing" contextKey={aiFeedbackKey(content)} />
            </div>
          )}

          {dueNow.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {phase === "cierre" ? "Cierra tu día" : "Para hoy"}
              </p>
              <ul className="space-y-1">
                {dueNow.map((t) => {
                  const busy = busyIds.includes(t.id);
                  return (
                    <li key={t.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-xs" title={t.title}>
                        {t.title}
                        {t.due_date && t.due_date.slice(0, 10) < todayKey && (
                          <span className="ml-1 text-[10px] text-destructive">vencida</span>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => closeTask(t.id, t.title, "done")}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" />
                        Hecha
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => closeTask(t.id, t.title, "tomorrow")}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <CalendarClock className="h-3 w-3" />
                        Mañana
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {content && Object.keys(briefing.metricInsights).length > 0 && (
            <MetricInsightChips
              insights={briefing.metricInsights}
              labels={DASHBOARD_METRIC_LABELS}
              order={[...DASHBOARD_METRIC_KEYS]}
            />
          )}

          <KawiilitoCompanion
            todayKey={todayKey}
            firstName={firstName}
            phase={phase}
            tasksCount={tasksCount}
            dueNow={dueNow.length}
            overdueCount={overdueCount}
            completedToday={completedToday}
            agreementsPending={
              (meetingFollowUp?.mine.length ?? 0) +
              Math.max(0, (meetingFollowUp?.unownedCount ?? 0) - (meetingFollowUp?.mine.filter((a) => a.unowned).length ?? 0))
            }
            generating={loading && !content}
          />

          {content && (
            <button
              onClick={() => void briefing.regenerate()}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-2 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
