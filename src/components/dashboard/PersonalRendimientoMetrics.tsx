import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  addDaysToYmd,
  mexicoDayRangeISO,
  toDateStringMX,
  isPastDueCalendarMX,
  formatDateMX,
} from "@/lib/dateUtils";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import {
  AlertTriangle,
  CalendarClock,
  ListTodo,
  Megaphone,
  RefreshCw,
  ArrowRight,
} from "lucide-react";

export type RendimientoPendingTask = {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  project_id: string | null;
};

function calendarDaysOverdue(dueRaw: string, todayYmd: string): number {
  const dueYmd = dueRaw.length >= 10 ? dueRaw.slice(0, 10) : dueRaw;
  if (dueYmd >= todayYmd) return 0;
  const a = new Date(`${dueYmd}T12:00:00`);
  const b = new Date(`${todayYmd}T12:00:00`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

function hasDueDateChange(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const c = (details as { changes?: unknown }).changes;
  return Array.isArray(c) && c.includes("due_date");
}

export function PersonalRendimientoMetrics({ pendingTasks }: { pendingTasks: RendimientoPendingTask[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = useMexicoToday();
  const todayYmd = toDateStringMX(today);

  const derived = useMemo(() => {
    const overdue = pendingTasks.filter((t) => t.due_date && isPastDueCalendarMX(t.due_date));
    const totalOverdueDays = overdue.reduce(
      (sum, t) => sum + calendarDaysOverdue(t.due_date!, todayYmd),
      0,
    );
    const noDueDate = pendingTasks.filter((t) => !t.due_date).length;
    const highPriority = pendingTasks.filter((t) => t.priority === "urgente" || t.priority === "alta").length;
    return {
      overdueCount: overdue.length,
      totalOverdueDays,
      avgOverdueDays: overdue.length ? Math.round((totalOverdueDays / overdue.length) * 10) / 10 : 0,
      noDueDate,
      highPriority,
      totalPending: pendingTasks.length,
      topOverdue: overdue.slice(0, 4),
    };
  }, [pendingTasks, todayYmd]);

  const rangeStart = useMemo(() => {
    const startYmd = addDaysToYmd(todayYmd, -6);
    return mexicoDayRangeISO(startYmd).start;
  }, [todayYmd]);

  const rangeEndExclusive = useMemo(() => mexicoDayRangeISO(addDaysToYmd(todayYmd, 1)).start, [todayYmd]);

  const { data: taskActivity7d } = useQuery({
    queryKey: ["personal-rendimiento-task-log", user?.id, rangeStart, rangeEndExclusive],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, action, details, created_at")
        .eq("user_id", user!.id)
        .eq("entity_type", "task")
        .gte("created_at", rangeStart)
        .lt("created_at", rangeEndExclusive)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: hubActivity7d } = useQuery({
    queryKey: ["personal-rendimiento-hub-log", user?.id, rangeStart, rangeEndExclusive],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("action, details, created_at")
        .eq("user_id", user!.id)
        .eq("entity_type", "hub")
        .gte("created_at", rangeStart)
        .lt("created_at", rangeEndExclusive);
      if (error) throw error;
      const rows = data ?? [];
      const hubContribActions = new Set([
        "hub_procedure_created",
        "hub_comunicado_created",
        "hub_procedure_version",
      ]);
      const pageViews = rows.filter((r) => r.action === "page_view").length;
      const contributions = rows.filter((r) => hubContribActions.has(r.action)).length;
      const exits = rows.filter((r) => r.action === "page_exit");
      const timeMs = exits.reduce((s, r) => {
        const ms = (r.details as { duration_ms?: number } | null)?.duration_ms;
        return s + (typeof ms === "number" ? ms : 0);
      }, 0);
      return {
        visits: pageViews,
        contributions,
        focusedTimeMinutes: Math.round(timeMs / 60000),
      };
    },
    enabled: !!user,
  });

  const nuevasFechas7d = useMemo(() => {
    if (!taskActivity7d) return 0;
    return taskActivity7d.filter((row) => row.action === "updated" && hasDueDateChange(row.details)).length;
  }, [taskActivity7d]);

  const metricClass =
    "rounded-xl border border-border/60 bg-card/40 p-3.5 text-left transition-colors hover:bg-secondary/30 hover:border-border";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Carga y seguimiento
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button type="button" className={metricClass} onClick={() => navigate("/tareas")}>
            <div className="flex items-start justify-between gap-2">
              <AlertTriangle
                className={`h-4 w-4 shrink-0 mt-0.5 ${derived.overdueCount > 0 ? "text-destructive" : "text-muted-foreground"}`}
              />
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground mt-2">{derived.overdueCount}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Atrasadas (vencidas)</p>
            {derived.overdueCount > 0 && (
              <p className="text-[10px] text-muted-foreground/90 mt-1.5 leading-snug">
                ~{derived.avgOverdueDays} días de retraso promedio · {derived.totalOverdueDays} días acumulados
              </p>
            )}
          </button>

          <div className={cn(metricClass, "cursor-default hover:bg-card/40 hover:border-border/60")}>
            <RefreshCw className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-2xl font-semibold tabular-nums text-foreground mt-2">{nuevasFechas7d}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Nuevas fechas (7 días)</p>
            <p className="text-[10px] text-muted-foreground/90 mt-1.5 leading-snug">
              Veces que moviste la fecha de entrega en tus tareas. Sube al reprogramar en el tablero.
            </p>
          </div>

          <button type="button" className={metricClass} onClick={() => navigate("/tareas")}>
            <div className="flex items-start justify-between gap-2">
              <ListTodo className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground mt-2">{derived.totalPending}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Qué falta (pendientes)</p>
            <p className="text-[10px] text-muted-foreground/90 mt-1.5 leading-snug">
              {derived.highPriority} alta/urgente · {derived.noDueDate} sin fecha límite
            </p>
          </button>

          <button type="button" className={metricClass} onClick={() => navigate("/hub")}>
            <div className="flex items-start justify-between gap-2">
              <Megaphone className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground mt-2">{hubActivity7d?.visits ?? 0}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">Visitas al Hub (7 días)</p>
            <div className="text-[10px] text-muted-foreground/90 mt-1.5 leading-snug space-y-1">
              {(hubActivity7d?.contributions ?? 0) > 0 ? (
                <p className="text-foreground/90">
                  {hubActivity7d!.contributions}{" "}
                  {hubActivity7d!.contributions === 1
                    ? "actualización tuya registrada"
                    : "actualizaciones tuyas registradas"}{" "}
                  (comunicados o procedimientos).
                </p>
              ) : null}
              {(hubActivity7d?.focusedTimeMinutes ?? 0) > 0 ? (
                <p>~{hubActivity7d!.focusedTimeMinutes} min acumulados al salir del Hub (visitas ≥2s).</p>
              ) : (hubActivity7d?.contributions ?? 0) === 0 ? (
                <p>Consulta procedimientos y comunicados; el tiempo se suma al cambiar de página.</p>
              ) : null}
            </div>
          </button>
        </div>
      </div>

      {derived.topOverdue.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              Prioriza estas atrasadas
            </p>
            <button
              type="button"
              onClick={() => navigate("/tareas")}
              className="text-[11px] text-primary hover:underline shrink-0"
            >
              Ir a tareas
            </button>
          </div>
          <ul className="space-y-1">
            {derived.topOverdue.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(t.project_id ? `/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}` : `/tareas?taskId=${t.id}`)
                  }
                  className="w-full flex items-center gap-2 py-2 px-2 rounded-lg text-left text-sm row-hover"
                >
                  <span className="truncate flex-1 text-foreground">{t.title}</span>
                  {t.due_date && (
                    <span className="text-xs text-destructive tabular-nums shrink-0">
                      {formatDateMX(t.due_date)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
