import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Plus,
  CheckSquare,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Users as UsersIcon,
  Search,
  Trash2,
} from "lucide-react";
import { useTasks, useMyAssignedTasks, useDeleteTask, useProfiles, useUpdateTask } from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";
import { useAssignedSteps } from "@/hooks/useAssignedSteps";
import { useReminders } from "@/hooks/useReminders";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { openNewTaskModal } from "@/lib/openNewTaskModal";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { TaskInlineQuickEdit } from "@/components/tasks/TaskInlineQuickEdit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { AiHeroV24 } from "@/components/dashboard/AiHeroV24";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { RecordatoriosEntryButton } from "@/components/reminders/RecordatoriosEntryButton";
import { useAuth } from "@/contexts/AuthContext";
import {
  isPastDueCalendarMX,
  toDateStringMX,
  mexicoDayRangeISO,
  addDaysToYmd,
} from "@/lib/dateUtils";
import { TASK_STATUS_CONFIG, STEP_STATUS_CONFIG } from "@/lib/statusStyles";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";

type StatusFilter = "todas" | "mias" | "vencidas" | "sin_resp";
type OrderMode = "fecha" | "prioridad" | "responsable";
type Vista = "activas" | "historial";

const statusLabels = TASK_STATUS_CONFIG;
const stepStatusLabels: Record<string, string> = Object.fromEntries(
  Object.entries(STEP_STATUS_CONFIG).map(([k, v]) => [k, v.label]),
);

function priorityClass(priority?: string | null): string {
  switch (priority) {
    case "urgente":
      return "prio-urgent";
    case "alta":
      return "prio-high";
    case "media":
      return "prio-medium";
    default:
      return "prio-low";
  }
}

function priorityRank(priority?: string | null): number {
  switch (priority) {
    case "urgente":
      return 0;
    case "alta":
      return 1;
    case "media":
      return 2;
    default:
      return 3;
  }
}

function statusDotClass(status?: string | null): string {
  switch (status) {
    case "en_progreso":
      return "s-progreso";
    case "en_revision":
      return "s-revision";
    case "completada":
      return "s-complet";
    case "cancelada":
      return "s-pausa";
    case "pendiente":
    default:
      return "s-pendiente";
  }
}

function formatDueCell(ymd: string | null | undefined, todayYmd: string): {
  label: string;
  className: string;
} {
  if (!ymd) return { label: "—", className: "cell-muted" };
  if (ymd < todayYmd) {
    const days = Math.floor(
      (new Date(todayYmd).getTime() - new Date(ymd).getTime()) / (24 * 60 * 60 * 1000),
    );
    const [, m, d] = ymd.split("-");
    const mx = monthAbbr(parseInt(m, 10));
    return {
      label: `Venció ${parseInt(d, 10)} ${mx}`,
      className: "cell-date overdue",
    };
  }
  const tomorrow = addDaysToYmd(todayYmd, 1);
  if (ymd === todayYmd) return { label: "Hoy", className: "cell-date soon" };
  if (ymd === tomorrow) return { label: "Mañana", className: "cell-date soon" };
  const in7 = addDaysToYmd(todayYmd, 7);
  const [, m, d] = ymd.split("-");
  const mx = monthAbbr(parseInt(m, 10));
  const label = `${parseInt(d, 10)} ${mx}`;
  if (ymd <= in7) return { label, className: "cell-date soon" };
  return { label, className: "cell-date" };
}

function monthAbbr(month1: number): string {
  const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return names[(month1 - 1 + 12) % 12];
}

const Tareas = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  useTasksRealtime();

  // ── Estado principal ────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todas");
  const [celula, setCelula] = useState<string>(() => searchParams.get("area") || "todas");
  const [orden, setOrden] = useState<OrderMode>("fecha");
  const [vista, setVista] = useState<Vista>(() => {
    if (typeof window === "undefined") return "activas";
    const p = new URLSearchParams(window.location.search);
    if (p.get("vista") === "historial") return "historial";
    const st = p.get("status");
    if (st === "completada" || st === "cancelada") return "historial";
    return "activas";
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    () => searchParams.get("taskId"),
  );
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const deleteTask = useDeleteTask();
  const { canDeleteTasks } = useUserRole();
  const { areaOptions, getCelulaLabel } = useAreaOptions();
  const { data: assignedSteps = [] } = useAssignedSteps();
  const { data: profiles = [] } = useProfiles();
  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.user_id, p.full_name])),
    [profiles],
  );
  const profileAvatarMap = useMemo(
    () => new Map(profiles.map((p) => [p.user_id, p.avatar_url])),
    [profiles],
  );

  // Sync URL → estado
  useEffect(() => {
    const urlTaskId = searchParams.get("taskId");
    if (urlTaskId && urlTaskId !== selectedTaskId) setSelectedTaskId(urlTaskId);
    const urlArea = searchParams.get("area");
    if (urlArea && urlArea !== celula) setCelula(urlArea);
    const v = searchParams.get("vista");
    const st = searchParams.get("status");
    if (v === "historial" || st === "completada" || st === "cancelada") setVista("historial");
    else setVista("activas");
  }, [searchParams]);

  const openTask = (task: {
    id: string;
    project_id?: string | null;
    phase_key?: string | null;
  }) => {
    const pid = task.project_id;
    if (pid) {
      const p = new URLSearchParams();
      p.set("tab", "tareas");
      p.set("taskId", task.id);
      if (task.phase_key) p.set("phaseKey", task.phase_key);
      navigate(`/proyectos/${pid}?${p.toString()}`);
      return;
    }
    setSelectedTaskId(task.id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("taskId", task.id);
      return next;
    });
  };
  const closeTask = () => {
    setSelectedTaskId(null);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("taskId");
      return p;
    });
  };

  // Edición rápida en línea — la fila se expande, no navega ni abre ventana.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const toggleExpand = (taskId: string) =>
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  const updateTask = useUpdateTask();
  const quickSetStatus = (taskId: string, status: string) => {
    updateTask.mutate({ id: taskId, status } as any);
  };

  const setVistaAndUrl = (next: Vista) => {
    setVista(next);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "historial") {
        p.set("vista", "historial");
        p.delete("status");
      } else {
        p.delete("vista");
        p.delete("status");
      }
      return p;
    });
  };

  // ── Datos ───────────────────────────────────────────────────
  const { data: tasks = [], isLoading } = useTasks({
    area: celula !== "todas" ? celula : undefined,
    search: search || undefined,
  });
  const { data: myAssignedRaw = [] } = useMyAssignedTasks();

  const today = useMexicoToday();
  const todayYmd = useMemo(() => toDateStringMX(today), [today]);
  const in7Ymd = useMemo(() => addDaysToYmd(todayYmd, 7), [todayYmd]);
  const { reminders } = useReminders();

  const { data: completedTodayCount } = useQuery({
    queryKey: ["tareas-hero-completed-today", user?.id, todayYmd],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { start, endExclusive } = mexicoDayRangeISO(todayYmd);
      const byCompleted = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .gte("completed_at", start)
        .lt("completed_at", endExclusive);
      if (byCompleted.error) throw byCompleted.error;
      const baseCount = byCompleted.count ?? 0;
      const byUpdated = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assigned_to", user!.id)
        .eq("status", "completada")
        .is("completed_at", null)
        .gte("updated_at", start)
        .lt("updated_at", endExclusive);
      if (byUpdated.error) throw byUpdated.error;
      return baseCount + (byUpdated.count ?? 0);
    },
  });

  const openTasks = useMemo(
    () => (tasks as any[]).filter((t) => !isTaskClosedStatus(t.status)),
    [tasks],
  );
  const closedTasks = useMemo(() => {
    const list = (tasks as any[]).filter((t) => isTaskClosedStatus(t.status));
    return [...list].sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at).getTime() -
        new Date(a.updated_at || a.created_at).getTime(),
    );
  }, [tasks]);

  const overdueCount = useMemo(
    () =>
      openTasks.filter((t) => t.due_date && isPastDueCalendarMX(t.due_date)).length,
    [openTasks],
  );
  const dueThisWeekCount = useMemo(
    () =>
      openTasks.filter((t) => {
        if (!t.due_date) return false;
        if (isPastDueCalendarMX(t.due_date)) return false;
        return t.due_date <= in7Ymd;
      }).length,
    [openTasks, in7Ymd],
  );
  const blockedCount = useMemo(
    () =>
      openTasks.filter((t) =>
        Boolean((t as any).is_blocked) ||
        (t as any).status === "bloqueada" ||
        (t as any).delay_category === "bloqueada",
      ).length,
    [openTasks],
  );
  const sinRespCount = useMemo(
    () => openTasks.filter((t) => !t.assigned_to).length,
    [openTasks],
  );
  const miasCount = useMemo(
    () =>
      openTasks.filter((t) => t.assigned_to === user?.id && !isTaskClosedStatus(t.status)).length,
    [openTasks, user?.id],
  );

  // ── Filtro de pills + ordenamiento ──────────────────────────
  const filteredOpen = useMemo(() => {
    let list = openTasks;
    switch (statusFilter) {
      case "mias":
        list = list.filter((t) => t.assigned_to === user?.id);
        break;
      case "vencidas":
        list = list.filter((t) => t.due_date && isPastDueCalendarMX(t.due_date));
        break;
      case "sin_resp":
        list = list.filter((t) => !t.assigned_to);
        break;
      default:
        break;
    }
    const sorted = [...list];
    if (orden === "fecha") {
      sorted.sort((a, b) => {
        const da = a.due_date ?? "9999-12-31";
        const db = b.due_date ?? "9999-12-31";
        if (da !== db) return da < db ? -1 : 1;
        return priorityRank(a.priority) - priorityRank(b.priority);
      });
    } else if (orden === "prioridad") {
      sorted.sort((a, b) => {
        const diff = priorityRank(a.priority) - priorityRank(b.priority);
        if (diff !== 0) return diff;
        const da = a.due_date ?? "9999-12-31";
        const db = b.due_date ?? "9999-12-31";
        return da < db ? -1 : da > db ? 1 : 0;
      });
    } else {
      sorted.sort((a, b) => {
        const na = a.assigned_to ? profileMap.get(a.assigned_to) ?? "" : "~";
        const nb = b.assigned_to ? profileMap.get(b.assigned_to) ?? "" : "~";
        return na.localeCompare(nb, "es");
      });
    }
    return sorted;
  }, [openTasks, statusFilter, orden, user?.id, profileMap]);

  // ── Stats del hero ──────────────────────────────────────────
  const heroStats = useMemo<Array<PageHeaderStat | false>>(() => {
    const myOpen = myAssignedRaw.filter((t) => !isTaskClosedStatus(t.status));
    const myOverdue = myOpen.filter(
      (t) => t.due_date && isPastDueCalendarMX(t.due_date),
    ).length;

    return [
      {
        label: "En curso",
        value: openTasks.length,
        sub: `${myOpen.length} asignada${myOpen.length === 1 ? "" : "s"} a ti`,
        tone: "default" as const,
      },
      {
        label: "Vencidas",
        value: myOverdue,
        sub: myOverdue > 0 ? "Requieren atención" : "Sin atrasos",
        tone: myOverdue > 0 ? ("warning" as const) : ("default" as const),
      },
      {
        label: "Esta semana",
        value: dueThisWeekCount,
        sub: dueThisWeekCount > 0 ? "Vencen en ≤7 días" : "Sin entregas próximas",
        tone: dueThisWeekCount > 0 ? ("warning" as const) : ("default" as const),
      },
      completedTodayCount != null && {
        label: "Hoy",
        value: completedTodayCount,
        sub: completedTodayCount === 0 ? "Aún ninguna" : "Completadas · buen ritmo",
        tone: "success" as const,
      },
      {
        label: "Bloqueadas",
        value: blockedCount,
        sub: blockedCount > 0 ? "Esperan info" : "Ninguna",
        tone: blockedCount > 0 ? ("warning" as const) : ("default" as const),
      },
    ];
  }, [myAssignedRaw, openTasks.length, dueThisWeekCount, completedTodayCount, blockedCount]);

  // ── Contexto para AiHeroV24 ─────────────────────────────────
  const topCritical = useMemo(
    () =>
      openTasks
        .filter(
          (t) =>
            t.priority === "urgente" ||
            (t.due_date && isPastDueCalendarMX(t.due_date)) ||
            (t as any).criticality_level === "critico",
        )
        .slice(0, 8)
        .map((t) => ({
          id: t.id,
          title: t.title,
          client: (t as any).clients?.name ?? null,
          dueInDays: t.due_date
            ? Math.round(
                (new Date(t.due_date).getTime() - new Date(todayYmd).getTime()) /
                  (24 * 60 * 60 * 1000),
              )
            : null,
          priority: t.priority ?? null,
        })),
    [openTasks, todayYmd],
  );

  return (
    <AppLayout>
      <div className="kwv24 space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          icon={<CheckSquare />}
          breadcrumb={["Kawiil OS", "Trabajo", "Tareas"]}
          iconAccent="linear-gradient(135deg, hsl(210 95% 55%), hsl(var(--primary)))"
          title="Tareas"
          description="Todo lo que tienes abierto en Kawiil — asignadas, delegadas y compartidas con tu célula."
          stats={heroStats}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <RecordatoriosEntryButton />
              <Button type="button" size="sm" onClick={() => openNewTaskModal()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Nueva tarea
              </Button>
            </div>
          }
        />

        <AiHeroV24
          module="tareas"
          ready={!isLoading}
          ctx={{
            tasksCount: openTasks.length,
            completedToday: completedTodayCount ?? 0,
            overdueCount,
            dueThisWeekCount,
            blockedCount,
            topCritical,
          }}
        />

        <div className="kpi-strip">
          <div className="kpi">
            <div className="label">En curso</div>
            <div className="num">{openTasks.length}</div>
            <div className="sub">{miasCount} asignada{miasCount === 1 ? "" : "s"} a ti</div>
          </div>
          <div className={`kpi ${overdueCount > 0 ? "danger" : ""}`}>
            <div className="label">Vencidas</div>
            <div className="num">{overdueCount}</div>
            <div className="sub">
              {overdueCount > 0 ? "Requieren atención" : "Sin atrasos"}
            </div>
          </div>
          <div className={`kpi ${dueThisWeekCount > 0 ? "warn" : ""}`}>
            <div className="label">Esta semana</div>
            <div className="num">{dueThisWeekCount}</div>
            <div className="sub">
              {dueThisWeekCount > 0 ? "Vencen en ≤7 días" : "Sin entregas próximas"}
            </div>
          </div>
          <div className="kpi ok">
            <div className="label">Completadas hoy</div>
            <div className="num">{completedTodayCount ?? 0}</div>
            <div className="sub">
              {(completedTodayCount ?? 0) === 0 ? "Aún ninguna" : "Buen ritmo 🎯"}
            </div>
          </div>
        </div>

        <div className="toolbar">
          <div className="search">
            <Search width={14} height={14} />
            <input
              placeholder="Buscar tareas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="pill-group">
            <button
              type="button"
              className={statusFilter === "todas" ? "active" : ""}
              onClick={() => setStatusFilter("todas")}
            >
              Todas<span className="count">{openTasks.length}</span>
            </button>
            <button
              type="button"
              className={statusFilter === "mias" ? "active" : ""}
              onClick={() => setStatusFilter("mias")}
            >
              Mías<span className="count">{miasCount}</span>
            </button>
            <button
              type="button"
              className={statusFilter === "vencidas" ? "active" : ""}
              onClick={() => setStatusFilter("vencidas")}
            >
              Vencidas<span className="count">{overdueCount}</span>
            </button>
            <button
              type="button"
              className={statusFilter === "sin_resp" ? "active" : ""}
              onClick={() => setStatusFilter("sin_resp")}
            >
              Sin resp.<span className="count">{sinRespCount}</span>
            </button>
          </div>
          <div className="divider" />
          <select
            className="select"
            value={celula}
            onChange={(e) => setCelula(e.target.value)}
          >
            <option value="todas">Todas las células</option>
            {areaOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={orden}
            onChange={(e) => setOrden(e.target.value as OrderMode)}
          >
            <option value="fecha">Ordenar: Fecha ↑</option>
            <option value="prioridad">Prioridad</option>
            <option value="responsable">Responsable</option>
          </select>
          <div style={{ flex: 1 }} />
          <div className="pill-group">
            <button
              type="button"
              className={vista === "activas" ? "active" : ""}
              onClick={() => setVistaAndUrl("activas")}
            >
              En curso
            </button>
            <button
              type="button"
              className={vista === "historial" ? "active" : ""}
              onClick={() => setVistaAndUrl("historial")}
            >
              Historial
            </button>
          </div>
        </div>

        {/* TABLA */}
        {vista === "activas" ? (
          <div className="mtable tareas">
            <div className="thead">
              <div />
              <div>Tarea</div>
              <div>Estado</div>
              <div>Responsable</div>
              <div>Célula</div>
              <div>Vence</div>
              <div />
            </div>
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Cargando tareas…
              </div>
            ) : filteredOpen.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <CheckSquare className="mx-auto mb-2 h-6 w-6 opacity-40" />
                Sin tareas con estos filtros.
              </div>
            ) : (
              filteredOpen.map((task) => {
                const due = formatDueCell(task.due_date, todayYmd);
                const assigneeName = task.assigned_to
                  ? profileMap.get(task.assigned_to) ?? null
                  : null;
                const assigneeAvatar = task.assigned_to
                  ? profileAvatarMap.get(task.assigned_to) ?? null
                  : null;
                const clientName = (task as any).clients?.name ?? null;
                const projectName = (task as any).projects?.name ?? null;
                const criticality = (task as any).criticality_level ?? null;
                return (
                  <div key={task.id} className={expandedTaskId === task.id ? "trow-group is-open" : "trow-group"}>
                  <div
                    className={`trow${expandedTaskId === task.id ? " is-open" : ""}`}
                    onClick={() => toggleExpand(task.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedTaskId === task.id}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(task.id);
                      }
                    }}
                  >
                    <div
                      className={`prio-dot ${priorityClass(task.priority)}`}
                      title={`Prioridad ${task.priority}`}
                    />
                    <div className="tname">
                      <span className="title">{task.title}</span>
                      <div className="meta">
                        {criticality === "critico" && (
                          <>
                            <span className="flag flag-critico">Crítico</span>
                            <span className="dot" />
                          </>
                        )}
                        {criticality === "atencion" && (
                          <>
                            <span className="flag flag-atencion">Atención</span>
                            <span className="dot" />
                          </>
                        )}
                        {clientName && <span>{clientName}</span>}
                        {clientName && projectName && <span className="dot" />}
                        {projectName && <span>{projectName}</span>}
                        {!clientName && !projectName && criticality == null && (
                          <span>Interno</span>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="status-cell text-left rounded-md hover:bg-muted/60 px-1 -mx-1 transition-colors"
                          title="Cambiar estatus"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className={`status-dot ${statusDotClass(task.status)}`} />
                          <span className="cell-text">
                            {statusLabels[task.status]?.label ?? task.status}
                          </span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                        {Object.entries(statusLabels).map(([key, { label }]) => (
                          <DropdownMenuItem
                            key={key}
                            disabled={task.status === key}
                            onSelect={() => quickSetStatus(task.id, key)}
                          >
                            {label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {assigneeName ? (
                      <div className="assignee">
                        <UserAvatar
                          name={assigneeName}
                          avatarUrl={assigneeAvatar}
                          userId={task.assigned_to}
                          size="sm"
                        />
                        <span className="name">{assigneeName}</span>
                      </div>
                    ) : (
                      <div className="assignee empty">
                        <span
                          className="avatar"
                          style={{ background: "hsl(var(--muted-foreground) / 0.3)" }}
                        >
                          ?
                        </span>
                        <span className="name">Sin asignar</span>
                      </div>
                    )}
                    <div className="cell-muted">
                      {task.area ? getCelulaLabel(task.area) : "—"}
                    </div>
                    <div className={due.className}>{due.label}</div>
                    {canDeleteTasks ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Eliminar"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ id: task.id, title: task.title });
                        }}
                      >
                        <Trash2 width={13} height={13} />
                      </button>
                    ) : (
                      <div />
                    )}
                  </div>
                  {expandedTaskId === task.id && (
                    <TaskInlineQuickEdit
                      taskId={task.id}
                      onOpenFull={() => openTask(task as any)}
                    />
                  )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="mtable tareas">
            <div className="thead">
              <div />
              <div>Tarea</div>
              <div>Estado</div>
              <div>Responsable</div>
              <div>Célula</div>
              <div>Cerrada</div>
              <div />
            </div>
            {closedTasks.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Sin tareas completadas ni canceladas.
              </div>
            ) : (
              closedTasks.map((task: any) => {
                const closedYmd = (task.updated_at || task.completed_at || task.created_at)?.slice(0, 10);
                const due = closedYmd
                  ? { label: `${parseInt(closedYmd.split("-")[2], 10)} ${monthAbbr(parseInt(closedYmd.split("-")[1], 10))}`, className: "cell-date" }
                  : { label: "—", className: "cell-muted" };
                const assigneeName = task.assigned_to
                  ? profileMap.get(task.assigned_to) ?? null
                  : null;
                const assigneeAvatar = task.assigned_to
                  ? profileAvatarMap.get(task.assigned_to) ?? null
                  : null;
                return (
                  <div key={task.id} className={expandedTaskId === task.id ? "trow-group is-open" : "trow-group"}>
                  <div
                    className={`trow${expandedTaskId === task.id ? " is-open" : ""}`}
                    onClick={() => toggleExpand(task.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedTaskId === task.id}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(task.id);
                      }
                    }}
                  >
                    <div className={`prio-dot ${priorityClass(task.priority)}`} />
                    <div className="tname">
                      <span
                        className="title"
                        style={
                          task.status === "cancelada"
                            ? { textDecoration: "line-through", opacity: 0.7 }
                            : undefined
                        }
                      >
                        {task.title}
                      </span>
                      <div className="meta">
                        {task.clients?.name && <span>{task.clients.name}</span>}
                        {task.projects?.name && (
                          <>
                            <span className="dot" />
                            <span>{task.projects.name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="status-cell text-left rounded-md hover:bg-muted/60 px-1 -mx-1 transition-colors"
                          title="Cambiar estatus"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className={`status-dot ${statusDotClass(task.status)}`} />
                          <span className="cell-text">
                            {statusLabels[task.status]?.label ?? task.status}
                          </span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                        {Object.entries(statusLabels).map(([key, { label }]) => (
                          <DropdownMenuItem
                            key={key}
                            disabled={task.status === key}
                            onSelect={() => quickSetStatus(task.id, key)}
                          >
                            {label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {assigneeName ? (
                      <div className="assignee">
                        <UserAvatar
                          name={assigneeName}
                          avatarUrl={assigneeAvatar}
                          userId={task.assigned_to}
                          size="sm"
                        />
                        <span className="name">{assigneeName}</span>
                      </div>
                    ) : (
                      <div className="assignee empty">
                        <span
                          className="avatar"
                          style={{ background: "hsl(var(--muted-foreground) / 0.3)" }}
                        >
                          ?
                        </span>
                        <span className="name">Sin asignar</span>
                      </div>
                    )}
                    <div className="cell-muted">
                      {task.area ? getCelulaLabel(task.area) : "—"}
                    </div>
                    <div className={due.className}>{due.label}</div>
                    <div />
                  </div>
                  {expandedTaskId === task.id && (
                    <TaskInlineQuickEdit
                      taskId={task.id}
                      onOpenFull={() => openTask(task)}
                    />
                  )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Pasos de proyecto asignados a ti */}
        {assignedSteps.length > 0 && (
          <details className="collapsible" open={false}>
            <summary>
              Pasos de proyecto asignados a ti
              <span className="count-pill">{assignedSteps.length}</span>
            </summary>
            <div className="body" style={{ padding: "8px 0 0" }}>
              {assignedSteps.slice(0, 50).map((step) => {
                const overdue = step.dueDate && isPastDueCalendarMX(step.dueDate);
                const due = formatDueCell(step.dueDate ?? null, todayYmd);
                return (
                  <div
                    key={step.id}
                    onClick={() =>
                      navigate(
                        `/proyectos/${step.projectId}?tab=${
                          step.sourceType === "contabilidad"
                            ? "contabilidad"
                            : step.sourceType === "declaracion_anual"
                              ? "declaracion_anual"
                              : step.sourceType === "juicio"
                                ? "juicio"
                                : step.sourceType === "gestoria"
                                  ? "gestoria"
                                  : "general"
                        }&step=${step.stepKey}`,
                      )
                    }
                    style={{
                      padding: "10px 16px",
                      borderTop: "1px solid hsl(var(--border) / 0.4)",
                      display: "grid",
                      gridTemplateColumns: "130px 1fr 120px 90px",
                      gap: 12,
                      alignItems: "center",
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    <span
                      className="cell-muted"
                      style={{
                        background: "hsl(var(--muted))",
                        padding: "3px 8px",
                        borderRadius: 6,
                        width: "fit-content",
                      }}
                    >
                      {step.sourceLabel}
                    </span>
                    <span className="cell-text">
                      {step.stepLabel}
                      {step.clientName ? ` — ${step.clientName}` : ""}
                    </span>
                    <span className={overdue ? "cell-date overdue" : due.className}>
                      {due.label}
                    </span>
                    {overdue ? (
                      <span className="flag flag-retraso">Retraso</span>
                    ) : (
                      <span className="cell-muted" style={{ fontSize: 11 }}>
                        {stepStatusLabels[step.status] || step.status}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      <TaskDetailDialog taskId={selectedTaskId} onClose={closeTask} />
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar tarea "${deleteTarget?.title}"?`}
        description="Se eliminará la tarea permanentemente junto con sus comentarios y asignaciones."
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteTask.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        isPending={deleteTask.isPending}
      />
    </AppLayout>
  );
};

export default Tareas;
