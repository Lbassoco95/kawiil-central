import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { toDateStringMX } from "@/lib/dateUtils";
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
  const [expanded, setExpanded] = useState(true);
  const today = useMexicoToday();
  const todayKey = toDateStringMX(today);

  const { data: taskDetails } = useQuery({
    queryKey: ["briefing-tasks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("title, status, priority, due_date, area, clients(name)")
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

  const ready = !!user && !!taskDetails;
  const firstName = profile?.full_name?.split(" ")[0] || "Kawiiler";
  const todayStr = today.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const payload = useMemo(() => {
    const taskIds = (taskDetails ?? []).map((t, i) => `${i}:${t.title}:${t.due_date ?? ""}:${t.status}:${t.priority}`);
    return {
      v: 3,
      module: "dashboard",
      date: todayKey,
      counts: { tasksCount, completedToday, overdueCount, remindersCount },
      tasks: taskIds,
    };
  }, [taskDetails, todayKey, tasksCount, completedToday, overdueCount, remindersCount]);

  const [payloadHash, setPayloadHash] = useState<string>("");
  useEffect(() => {
    if (!ready) return;
    void sha256Hex(JSON.stringify(payload)).then(setPayloadHash);
  }, [payload, ready]);

  const briefing = useAiModuleBriefing({
    module: "dashboard",
    payloadHash,
    // Hero principal: 1 briefing automático al día. El blindaje 1/día del hook
    // garantiza que cambios de hash durante el día NO regeneran (solo regenerate()).
    autoFetch: true,
    enabled: ready && !!payloadHash,
    buildMessages: () => {
      const contextPrompt = `Genera un briefing corto y motivador del día para ${firstName}. Hoy es ${todayStr}.

DATOS (cifras oficiales — úsalas para cualquier total): ${tasksCount} tareas pendientes en total, ${completedToday} completadas hoy, ${overdueCount} vencidas, ${remindersCount} recordatorios.

PRÓXIMAS TAREAS (solo una MUESTRA de las ${tasksCount} pendientes: las más próximas por vencer, asignadas a ${firstName}, ordenadas por fecha): ${JSON.stringify((taskDetails ?? []).map((t) => ({ titulo: t.title, prioridad: t.priority, vence: t.due_date, area: t.area, cliente: (t as unknown as { clients?: { name?: string } }).clients?.name ?? null, estado: t.status })))}

INSTRUCCIONES PARA "markdown":
1. Resume en máximo 3 puntos clave con emojis.
2. Al nombrar tareas, fechas o clientes usa ÚNICAMENTE los del bloque PRÓXIMAS TAREAS; NO inventes ninguno que no esté ahí.
3. Para cualquier TOTAL de pendientes usa la cifra de DATOS (${tasksCount}); NUNCA cuentes las filas de la muestra — es solo un extracto de las más próximas, no el total.
4. Si hay vencidas, menciona con empatía.
5. Si completó, reconoce.
6. Máximo 80 palabras. Sé ultra-conciso.
7. Markdown obligatorio: línea de título con emoji (ej. 🗒️ **Briefing del …**), subtítulo **Situación actual**, viñetas con emojis (🔥 ⚠️ ✅), **negritas** en cifras y alertas. Sin saludo largo.

INSTRUCCIONES PARA "metric_insights":
- tasks_pendientes: 1 frase sobre la carga de tareas pendientes (usa el total ${tasksCount}, no el tamaño de la muestra) y el siguiente foco.
- completadas_hoy: 1 frase que reconozca el avance o anime a avanzar si es 0.
- vencidas: 1 frase concreta con la acción para retomar si hay vencidas; si es 0, omite la clave.
- recordatorios: 1 frase útil sobre el estado de los recordatorios; si es 0, omite la clave.${briefingJsonInstructions({ metricKeys: [...DASHBOARD_METRIC_KEYS] })}`;
      return [{ role: "user", content: contextPrompt }];
    },
  });

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

          {content && Object.keys(briefing.metricInsights).length > 0 && (
            <MetricInsightChips
              insights={briefing.metricInsights}
              labels={DASHBOARD_METRIC_LABELS}
              order={[...DASHBOARD_METRIC_KEYS]}
            />
          )}

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
