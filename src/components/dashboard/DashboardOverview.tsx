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

import { useMyAssignedTasks } from "@/hooks/useTasks";
import { useAssignedSteps } from "@/hooks/useAssignedSteps";
import { useMyActiveProjectsProgress } from "@/hooks/useMyActiveProjectsProgress";
import { useClients } from "@/hooks/useClients";
import { useCelulaOptions } from "@/hooks/useCelulaOptions";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { toDateStringMX } from "@/lib/dateUtils";
import { TASK_STATUS_CONFIG } from "@/lib/statusStyles";
import { cn } from "@/lib/utils";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

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

export function DashboardOverview() {
  const navigate = useNavigate();
  const today = useMexicoToday();
  const todayKey = toDateStringMX(today);

  const { data: myTasks = [] } = useMyAssignedTasks();
  const { data: assignedSteps = [] } = useAssignedSteps();
  const { data: myProjects = [] } = useMyActiveProjectsProgress();
  const { data: clients = [] } = useClients();
  const { getCelulaLabel, celulaOptions } = useCelulaOptions();

  const celulaColor = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const c of celulaOptions) map[c.value] = c.color || undefined;
    return map;
  }, [celulaOptions]);

  const stats = useMemo(() => {
    const openTasks = myTasks.filter((t) => t.status !== "completada" && t.status !== "cancelada");
    const todayTasks = openTasks.filter((t) => t.due_date && t.due_date === todayKey);
    const overdueTasks = openTasks.filter((t) => t.due_date && t.due_date < todayKey);
    const waitingClient = openTasks.filter((t) => t.status === "en_revision");
    const activeClients = clients.filter((c) => c.status === "activo");

    return {
      tasksToday: todayTasks.length,
      overdueCount: overdueTasks.length,
      activeProjects: myProjects.length,
      activeClients: activeClients.length,
      waitingClient: waitingClient.length,
    };
  }, [myTasks, clients, myProjects, todayKey]);

  const topTasks = useMemo(() => {
    const order: Record<string, number> = { urgente: 0, alta: 1, media: 2, baja: 3 };
    return [...myTasks]
      .filter((t) => t.status !== "completada" && t.status !== "cancelada")
      .sort((a, b) => {
        const pa = order[a.priority ?? "baja"] ?? 4;
        const pb = order[b.priority ?? "baja"] ?? 4;
        if (pa !== pb) return pa - pb;
        const da = a.due_date ?? "9999-12-31";
        const db = b.due_date ?? "9999-12-31";
        return da.localeCompare(db);
      })
      .slice(0, 5);
  }, [myTasks]);

  const topSteps = useMemo(() => assignedSteps.slice(0, 8), [assignedSteps]);

  const formatDue = (raw: string | null | undefined): { label: string; overdue: boolean } => {
    if (!raw) return { label: "Sin fecha", overdue: false };
    if (raw === todayKey) return { label: "Hoy", overdue: false };
    if (raw < todayKey) return { label: "Vencido", overdue: true };
    try {
      const [y, m, d] = raw.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return {
        label: dt.toLocaleDateString("es-MX", { day: "numeric", month: "short" }),
        overdue: false,
      };
    } catch {
      return { label: raw, overdue: false };
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          delta={`${clients.length} en cartera`}
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

      {/* Two columns: tasks + steps */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Mis tareas del tablero */}
        <div className="surface-toolbar p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
              <UserCheck className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-semibold">Mis tareas del tablero</h2>
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">
              {topTasks.length} en curso
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
            <p className="py-6 text-center text-xs text-muted-foreground">
              No tienes tareas asignadas en el tablero.
            </p>
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
                          <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">
                            {t.clients.name}
                          </span>
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

        {/* Pasos de proyecto */}
        <div className="surface-toolbar p-4">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Pasos de proyecto</h2>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">
              {assignedSteps.length}
            </span>
          </div>
          {topSteps.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Sin pasos asignados pendientes.
            </p>
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
                      className={cn(
                        "shrink-0 text-[10px]",
                        due.overdue ? "font-semibold text-destructive" : "text-muted-foreground",
                      )}
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
    </div>
  );
}
