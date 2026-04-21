import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckSquare,
  FolderKanban,
  Users,
  Clock,
  UserCheck,
  ClipboardList,
  Calendar,
  ArrowRight,
} from "lucide-react";

import type { Task } from "@/hooks/useTasks";
import { useCelulaOptions } from "@/hooks/useCelulaOptions";
import { toDateStringMX } from "@/lib/dateUtils";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { TASK_STATUS_CONFIG } from "@/lib/statusStyles";
import { cn } from "@/lib/utils";
import type { AssignedStep } from "@/hooks/useAssignedSteps";

type Tone = "info" | "success" | "warn" | "danger";

const TONE_STYLES: Record<Tone, { bar: string; text: string; iconBg: string }> = {
  info: {
    bar: "border-l-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    iconBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  success: {
    bar: "border-l-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  warn: {
    bar: "border-l-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  danger: {
    bar: "border-l-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    iconBg: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
};

function priorityBarClass(p?: string | null) {
  switch (p) {
    case "urgente":
      return "priority-bar-urgent";
    case "alta":
      return "priority-bar-high";
    case "media":
      return "priority-bar-medium";
    default:
      return "priority-bar-low";
  }
}

function StatCard({
  label,
  value,
  delta,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  delta?: string;
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className={cn("stat-card border-l-[3px]", t.bar)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
          {delta && <p className={cn("text-[11px] mt-1", t.text)}>{delta}</p>}
        </div>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", t.iconBg)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

export type OperativeKpiStats = {
  tasksToday: number;
  overdueCount: number;
  activeProjects: number;
  activeClients: number;
  waitingClient: number;
};

type PersonalDashboardKpiRowProps = {
  stats: OperativeKpiStats;
  carteraSize: number;
  className?: string;
};

/** Fila de 4 stat cards v2.4 (misma semántica que el antiguo DashboardOverview). */
export function PersonalDashboardKpiRow({ stats, carteraSize, className }: PersonalDashboardKpiRowProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4 animate-fade-in stagger-2", className)} style={{ animationFillMode: "both" }}>
      <StatCard
        label="Tareas del día"
        value={stats.tasksToday}
        delta={stats.overdueCount > 0 ? `${stats.overdueCount} vencidas` : "Al día"}
        tone={stats.overdueCount > 0 ? "warn" : "success"}
        icon={CheckSquare}
      />
      <StatCard
        label="Proyectos activos"
        value={stats.activeProjects}
        delta="A tu cargo"
        tone="info"
        icon={FolderKanban}
      />
      <StatCard
        label="Clientes activos"
        value={stats.activeClients}
        delta={`${carteraSize} en cartera`}
        tone="success"
        icon={Users}
      />
      <StatCard
        label="En espera del cliente"
        value={stats.waitingClient}
        delta={stats.waitingClient > 0 ? "Requiere seguimiento" : "Sin pendientes"}
        tone="warn"
        icon={Clock}
      />
    </div>
  );
}

type PersonalBoardTasksAndProjectStepsProps = {
  topTasks: Task[];
  enCursoTotal: number;
  topSteps: AssignedStep[];
  assignedStepCount: number;
};

/**
 * Bloque "Mis tareas del tablero" + "Pasos de proyecto" (superficie v2.4,
 * heredado de DashboardOverview).
 */
export function PersonalBoardTasksAndProjectSteps({
  topTasks,
  enCursoTotal,
  topSteps,
  assignedStepCount,
}: PersonalBoardTasksAndProjectStepsProps) {
  const navigate = useNavigate();
  const today = useMexicoToday();
  const todayKey = toDateStringMX(today);
  const { getCelulaLabel, celulaOptions } = useCelulaOptions();

  const celulaColor = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const c of celulaOptions) map[c.value] = c.color || undefined;
    return map;
  }, [celulaOptions]);

  const formatDue = (raw: string | null | undefined): { label: string; overdue: boolean } => {
    if (!raw) return { label: "Sin fecha", overdue: false };
    const ymd = raw.slice(0, 10);
    if (ymd === todayKey) return { label: "Hoy", overdue: false };
    if (ymd < todayKey) return { label: "Vencido", overdue: true };
    try {
      const [y, m, d] = ymd.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return {
        label: dt.toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
        overdue: false,
      };
    } catch {
      return { label: ymd, overdue: false };
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="surface-toolbar p-4 lg:col-span-2">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
            <UserCheck className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold">Mis tareas del tablero</h2>
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">
            {enCursoTotal} en curso
          </span>
          <button
            type="button"
            onClick={() => navigate("/tareas")}
            className="ml-auto text-xs text-primary hover:underline"
          >
            Ver todas →
          </button>
        </div>

        {topTasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No tienes tareas asignadas en el tablero.</p>
        ) : (
          <div className="space-y-2">
            {topTasks.map((t) => {
              const due = formatDue(t.due_date);
              const statusCfg = TASK_STATUS_CONFIG[t.status as keyof typeof TASK_STATUS_CONFIG];
              const areaColor = t.area ? celulaColor[t.area] : undefined;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate(`/tareas?taskId=${t.id}`)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2.5 text-left transition-colors hover:bg-secondary/30",
                    priorityBarClass(t.priority),
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <h3 className="truncate text-sm font-medium">{t.title}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {statusCfg && (
                        <span className={cn("rounded-full px-1.5 py-0 text-[10px] font-medium", statusCfg.color)}>
                          {statusCfg.label}
                        </span>
                      )}
                      {t.area && (
                        <span className="inline-flex items-center gap-1.5 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: areaColor || "hsl(var(--primary))" }}
                          />
                          {getCelulaLabel(t.area)}
                        </span>
                      )}
                      {t.clients?.name && (
                        <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">{t.clients.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "flex items-center gap-1 text-xs",
                        due.overdue ? "font-medium text-destructive" : "text-muted-foreground",
                      )}
                    >
                      <Calendar className="h-3 w-3" />
                      {due.label}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="surface-toolbar p-4">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Pasos de proyecto</h2>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">
            {assignedStepCount}
          </span>
        </div>
        {topSteps.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Sin pasos asignados pendientes.</p>
        ) : (
          <div className="space-y-1.5">
            {topSteps.map((s) => {
              const due = formatDue(s.dueDate);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(`/proyectos/${s.projectId}`)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
                    due.overdue
                      ? "border-destructive/15 bg-destructive/5"
                      : "border-transparent hover:bg-secondary/40",
                  )}
                >
                  <span className="shrink-0 rounded bg-secondary/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {s.sourceLabel}
                  </span>
                  <span className="flex-1 truncate font-medium">{s.stepLabel}</span>
                  <span
                    className={cn("shrink-0 text-[10px]", due.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}
                  >
                    {due.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
