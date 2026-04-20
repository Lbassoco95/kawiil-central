import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, CheckSquare, Calendar, User, Trash2, ClipboardList, ArrowRight, Archive, UserCheck, ChevronRight } from "lucide-react";
import { useTasks, useMyAssignedTasks, useDeleteTask, useProfiles } from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";
import { useAssignedSteps } from "@/hooks/useAssignedSteps";
import { useReminders } from "@/hooks/useReminders";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { openNewTaskModal } from "@/lib/openNewTaskModal";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { TasksAIPanoramaCard } from "@/components/tareas/TasksAIPanoramaCard";
import { QuickCreateInput } from "@/components/tareas/QuickCreateInput";
import { TaskStatusTabs, type TaskStatusFilter, type TaskViewMode } from "@/components/tareas/TaskStatusTabs";
import {
  TaskFiltersDrawer,
  useTaskAdvancedFilters,
} from "@/components/tareas/TaskFiltersDrawer";
import { TaskGroupedList } from "@/components/tareas/TaskGroupedList";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { ScrollableFilterTabs } from "@/components/shared/ScrollableFilterTabs";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { RecordatoriosEntryButton } from "@/components/reminders/RecordatoriosEntryButton";
import { useAuth } from "@/contexts/AuthContext";
import {
  formatMX,
  isPastDueCalendarMX,
  toDateStringMX,
  mexicoDayRangeISO,
  addDaysToYmd,
} from "@/lib/dateUtils";
import { TaskKanbanBoard } from "@/components/tareas/TaskKanbanBoard";
import { TaskTimelineView } from "@/components/tareas/TaskTimelineView";
import { TASK_STATUS_CONFIG, STEP_STATUS_CONFIG } from "@/lib/statusStyles";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const statusLabels = TASK_STATUS_CONFIG;

const stepStatusLabels: Record<string, string> = Object.fromEntries(
  Object.entries(STEP_STATUS_CONFIG).map(([k, v]) => [k, v.label])
);

const Tareas = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  useTasksRealtime();
  const [area, setArea] = useState(() => searchParams.get("area") || "todas");
  const [search, setSearch] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => searchParams.get("taskId"));
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [showAllMyOpen, setShowAllMyOpen] = useState(false);
  const deleteTask = useDeleteTask();
  const { canDeleteTasks } = useUserRole();
  const { areaOptions, areaLabelMap, getCelulaLabel } = useAreaOptions();
  const { data: assignedSteps = [] } = useAssignedSteps();
  const { data: profiles = [] } = useProfiles();
  const profileMap = useMemo(() => new Map(profiles.map(p => [p.user_id, p.full_name])), [profiles]);
  const areaColorMap = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const o of areaOptions) m.set(o.value, (o as any).color || undefined);
    return m;
  }, [areaOptions]);

  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("todas");
  const [viewMode, setViewMode] = useState<TaskViewMode>(() => {
    if (typeof window === "undefined") return "lista";
    const v = window.localStorage.getItem("kawiil-tareas-view");
    if (v === "kanban" || v === "timeline" || v === "calendario" || v === "lista") {
      return v as TaskViewMode;
    }
    return "lista";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("kawiil-tareas-view", viewMode); } catch { /* ignore */ }
  }, [viewMode]);
  const { filters: advFilters, setFilters: setAdvFilters, clear: clearAdvFilters, activeCount: advActiveCount } = useTaskAdvancedFilters();

  const [vistaTareas, setVistaTareas] = useState<"activas" | "historial">(() => {
    if (typeof window === "undefined") return "activas";
    const p = new URLSearchParams(window.location.search);
    if (p.get("vista") === "historial") return "historial";
    const st = p.get("status");
    if (st === "completada" || st === "cancelada") return "historial";
    return "activas";
  });

  // Sync selectedTaskId with URL query param for deep links
  useEffect(() => {
    const urlTaskId = searchParams.get("taskId");
    if (urlTaskId && urlTaskId !== selectedTaskId) {
      setSelectedTaskId(urlTaskId);
    }
    const urlArea = searchParams.get("area");
    if (urlArea && urlArea !== area) {
      setArea(urlArea);
    }
    const v = searchParams.get("vista");
    const st = searchParams.get("status");
    if (v === "historial" || st === "completada" || st === "cancelada") {
      setVistaTareas("historial");
    } else {
      setVistaTareas("activas");
    }
  }, [searchParams]);

  /** Si la tarea pertenece a un proyecto, abre el proyecto en pestaña Tareas con el detalle; si no, modal en /tareas. */
  const openTask = (task: { id: string; project_id?: string | null; phase_key?: string | null }) => {
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
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete("taskId"); return p; });
  };

  const setVistaTareasAndUrl = (next: "activas" | "historial") => {
    setVistaTareas(next);
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

  const { data: tasks, isLoading } = useTasks({
    area: area !== "todas" ? area : undefined,
    search: search || undefined,
  });

  const { data: myAssignedRaw = [], isLoading: myAssignedLoading } = useMyAssignedTasks();

  const myOpenTasks = useMemo(() => {
    const open = myAssignedRaw.filter((t) => !isTaskClosedStatus(t.status));
    const pr = { urgente: 0, alta: 1, media: 2, baja: 3 } as Record<string, number>;
    return [...open].sort((a, b) => {
      const oa = a.due_date && isPastDueCalendarMX(a.due_date) ? 0 : 1;
      const ob = b.due_date && isPastDueCalendarMX(b.due_date) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const da = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return (pr[a.priority] ?? 4) - (pr[b.priority] ?? 4);
    });
  }, [myAssignedRaw]);

  const myClosedTasks = useMemo(() => {
    const closed = myAssignedRaw.filter((t) => isTaskClosedStatus(t.status));
    return [...closed].sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    );
  }, [myAssignedRaw]);

  const openTasks = useMemo(() => tasks?.filter((t: any) => !isTaskClosedStatus(t.status)) ?? [], [tasks]);

  const advFilteredOpen = useMemo(() => {
    return (openTasks as any[]).filter((t) => {
      if (advFilters.clientId && t.client_id !== advFilters.clientId) return false;
      if (advFilters.projectId && t.project_id !== advFilters.projectId) return false;
      if (advFilters.assignedTo && t.assigned_to !== advFilters.assignedTo) return false;
      if (advFilters.area && t.area !== advFilters.area) return false;
      if (advFilters.priority && t.priority !== advFilters.priority) return false;
      return true;
    });
  }, [openTasks, advFilters]);

  const statusCounts = useMemo(() => ({
    todas: advFilteredOpen.length,
    pendientes: advFilteredOpen.filter((t: any) => t.status === "pendiente").length,
    en_curso: advFilteredOpen.filter((t: any) => t.status === "en_progreso" || t.status === "en_revision").length,
    vencidas: advFilteredOpen.filter((t: any) => t.due_date && isPastDueCalendarMX(t.due_date)).length,
    criticas: advFilteredOpen.filter(
      (t: any) => t.criticality_level === "critico" || t.priority === "urgente",
    ).length,
  }), [advFilteredOpen]);

  const filteredOpenTasks = useMemo(() => {
    switch (statusFilter) {
      case "pendientes":
        return advFilteredOpen.filter((t: any) => t.status === "pendiente");
      case "en_curso":
        return advFilteredOpen.filter((t: any) => t.status === "en_progreso" || t.status === "en_revision");
      case "vencidas":
        return advFilteredOpen.filter((t: any) => t.due_date && isPastDueCalendarMX(t.due_date));
      case "criticas":
        return advFilteredOpen.filter(
          (t: any) => t.criticality_level === "critico" || t.priority === "urgente",
        );
      default:
        return advFilteredOpen;
    }
  }, [advFilteredOpen, statusFilter]);

  const closedTasks = useMemo(() => {
    const list = tasks?.filter((t: any) => isTaskClosedStatus(t.status)) ?? [];
    return [...list].sort(
      (a: any, b: any) =>
        new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
    );
  }, [tasks]);

  // ─── Hero stats: contadores por usuario, en zona CDMX ────────
  const today = useMexicoToday();
  const todayYmd = useMemo(() => toDateStringMX(today), [today]);
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

  const heroStats = useMemo<Array<PageHeaderStat | false>>(() => {
    const myPending = myAssignedLoading ? null : myOpenTasks.length;
    const myOverdue = myAssignedLoading
      ? null
      : myOpenTasks.filter((t: any) => t.due_date && isPastDueCalendarMX(t.due_date)).length;

    const sevenDaysFromTodayYmd = addDaysToYmd(todayYmd, 7);
    const upcomingReminders = reminders.filter((r) => {
      if (r.is_completed) return false;
      if (!r.due_date) return false;
      return r.due_date <= sevenDaysFromTodayYmd;
    }).length;

    const teamPending = openTasks.length;

    return [
      myPending != null && {
        label: "Mis pendientes",
        value: myPending,
        sub: teamPending > 0 ? `${teamPending} de equipo` : "asignadas a mí",
        tone: "default" as const,
      },
      myOverdue != null && {
        label: "Vencidas",
        value: myOverdue,
        sub: myOverdue > 0 ? "atender hoy" : "sin atrasos",
        tone: myOverdue > 0 ? ("warning" as const) : ("default" as const),
      },
      completedTodayCount != null && {
        label: "Completadas hoy",
        value: completedTodayCount,
        sub: completedTodayCount === 0 ? "aún ninguna" : "buen ritmo",
        tone: "success" as const,
      },
      {
        label: "Recordatorios",
        value: upcomingReminders,
        sub: upcomingReminders > 0 ? "próximos 7 días" : "ninguno próximo",
        tone: "primary" as const,
      },
    ];
  }, [myAssignedLoading, myOpenTasks, openTasks.length, reminders, todayYmd, completedTodayCount]);

  const tasksSummaryPrompt = useMemo(() => {
    if (!tasks) return "";
    const pending = tasks.filter((t: any) => !isTaskClosedStatus(t.status));
    const overdue = pending.filter((t: any) => t.due_date && isPastDueCalendarMX(t.due_date));
    const critical = tasks.filter((t: any) => (t as any).criticality_level === "critico");
    const byPriority: Record<string, number> = {};
    const byArea: Record<string, number> = {};
    pending.forEach((t: any) => {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      if (t.area) { const lbl = getCelulaLabel(t.area); byArea[lbl] = (byArea[lbl] || 0) + 1; }
    });

    // Build assigned steps context
    const overdueSteps = assignedSteps.filter((s) => isPastDueCalendarMX(s.dueDate));
    const stepsContext = assignedSteps.length > 0 ? `
PASOS DE PROYECTO ASIGNADOS A MÍ (${assignedSteps.length} total, ${overdueSteps.length} vencidos):
${assignedSteps.slice(0, 8).map(s => {
  const isOverdue = isPastDueCalendarMX(s.dueDate);
  return `  ${isOverdue ? "⚠️" : "📋"} ${s.stepLabel} — Proyecto: ${s.projectName} [${s.sourceLabel}]${s.dueDate ? ` vence: ${s.dueDate}` : ""}${s.isCollaborator ? " (colaborador)" : ""}`;
}).join("\n")}` : "";

    return `Genera un resumen breve del estado de las tareas del equipo. Español mexicano, tono profesional, emojis.

DATOS:
- Total tareas visibles: ${tasks.length}
- Pendientes: ${pending.length}
- Vencidas: ${overdue.length}
- Críticas (semáforo rojo): ${critical.length}

POR PRIORIDAD: ${Object.entries(byPriority).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}
POR CÉLULA: ${Object.entries(byArea).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}

TAREAS VENCIDAS MÁS ANTIGUAS:
${overdue.slice(0, 5).map((t: any) => `- ${t.title} (${t.priority}, vence: ${t.due_date})`).join("\n") || "Ninguna"}
${stepsContext}

INSTRUCCIONES:
1. Resume en 3-4 puntos el panorama de tareas con emojis.
2. Si hay vencidas, menciona las más urgentes.
3. Si hay pasos de proyecto asignados, menciona los más importantes y si alguno está vencido.
4. Si hay críticas, destácalas.
5. Sugiere por dónde empezar hoy.
6. Máximo 120 palabras. Usa markdown.`;
  }, [tasks, assignedSteps, areaLabelMap]);

  const getDateColor = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    if (d < now) return "text-destructive font-medium";
    if (d <= weekFromNow) return "text-warning font-medium";
    return "text-muted-foreground";
  };

  const getPriorityBar = (priority: string) => {
    switch (priority) {
      case "urgente": return "priority-bar-urgent";
      case "alta": return "priority-bar-high";
      case "media": return "priority-bar-medium";
      default: return "priority-bar-low";
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          icon={<CheckSquare />}
          title="Tareas"
          description="Gestión de tareas y actividades internas"
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

        <div className="surface-toolbar space-y-2 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
            <div className="min-w-0 flex-1">
              <QuickCreateInput area={area !== "todas" ? area : undefined} />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 w-full sm:w-auto"
              onClick={() => openNewTaskModal()}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Formulario completo
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Tokens: <code className="rounded bg-muted px-1">@persona</code>{" "}
            <code className="rounded bg-muted px-1">#cliente</code>{" "}
            <code className="rounded bg-muted px-1">!prioridad</code>{" "}
            <code className="rounded bg-muted px-1">/fecha</code> · Enter para crear · «Formulario completo» abre todos los campos.
          </p>
        </div>

        <TasksAIPanoramaCard
          tasks={tasks}
          getCelulaLabel={getCelulaLabel}
          cacheKey={`tasks-${user?.id}-${area}`}
          contextPrompt={tasksSummaryPrompt}
          userId={user?.id}
        />

        <section className="animate-fade-in surface-glass-subtle p-4 ring-1 ring-primary/10">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between mb-3">
            <div className="flex items-start gap-2 min-w-0">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <UserCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Mis tareas del tablero</h2>
                  <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-medium tabular-nums">
                    {myOpenTasks.length} en curso
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug max-w-xl">
                  Solo tareas internas donde eres responsable. Los pasos dentro de proyectos (constitución, gestoría, etc.) están en la sección de abajo.
                </p>
              </div>
            </div>
          </div>

          {myAssignedLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-secondary/40 animate-pulse" />
              ))}
            </div>
          ) : myOpenTasks.length === 0 && myClosedTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6 px-2">
              No tienes tareas del tablero asignadas. Pueden asignártelas desde el detalle de una tarea o al crearla.
            </p>
          ) : (
            <div className="space-y-2">
              {myOpenTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">No tienes tareas del tablero en curso.</p>
              ) : (
                <>
                  {(showAllMyOpen ? myOpenTasks : myOpenTasks.slice(0, 10)).map((task, i) => (
                    <div
                      key={task.id}
                      className={cn(
                        "flex items-center gap-3 py-2.5 px-3 rounded-xl cursor-pointer border border-border/50 bg-background/80 hover:bg-background card-hover-subtle",
                        getPriorityBar(task.priority),
                        (task as any).delay_category && "bg-warning/[0.04]"
                      )}
                      style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
                      onClick={() => openTask(task)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="text-sm font-medium text-foreground truncate">{task.title}</h3>
                          {(task as any).criticality_level === "critico" && <span className="text-[10px] shrink-0" title="Crítico">🔴</span>}
                          {(task as any).criticality_level === "atencion" && <span className="text-[10px] shrink-0" title="Atención">🟡</span>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge className={cn("text-[10px] border-0 px-1.5 py-0", statusLabels[task.status]?.color)} variant="secondary">
                            {statusLabels[task.status]?.label}
                          </Badge>
                          {task.area && (
                            <span className="inline-flex items-center gap-1.5 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{ background: areaColorMap.get(task.area) || "hsl(var(--primary))" }}
                              />
                              {getCelulaLabel(task.area)}
                            </span>
                          )}
                          {(task as any).clients?.name && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{(task as any).clients.name}</span>
                          )}
                          {(task as any).projects?.name && (
                            <span className="text-[10px] text-muted-foreground/80 truncate max-w-[120px]">{(task as any).projects.name}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {task.due_date && (
                          <span className={cn("text-xs flex items-center gap-1", getDateColor(task.due_date))}>
                            <Calendar className="h-3 w-3" />
                            {formatMX(task.due_date, "dd MMM")}
                          </span>
                        )}
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                      </div>
                    </div>
                  ))}
                  {myOpenTasks.length > 10 && (
                    <button
                      type="button"
                      onClick={() => setShowAllMyOpen(!showAllMyOpen)}
                      className="text-xs text-primary hover:text-primary/80 text-center py-1 w-full transition-colors"
                    >
                      {showAllMyOpen ? "Mostrar menos" : `+${myOpenTasks.length - 10} tareas más — ver todas`}
                    </button>
                  )}
                </>
              )}

              {myClosedTasks.length > 0 && (
                <Collapsible defaultOpen={false} className="group rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
                  <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                    Mi historial del tablero — completadas o canceladas ({myClosedTasks.length})
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1 px-2 pb-2 pt-0 border-t border-border/30">
                      {myClosedTasks.map((task) => (
                        <div
                          key={task.id}
                          className={cn(
                            "flex items-center gap-3 py-2 px-2 rounded-lg cursor-pointer hover:bg-muted/50 text-muted-foreground",
                            task.status === "cancelada" && "opacity-80"
                          )}
                          onClick={() => openTask(task)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-[13px] font-medium truncate", task.status === "cancelada" && "line-through")}>
                              {task.title}
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-0.5">
                              <Badge className={cn("text-[9px] border-0 px-1 py-0", statusLabels[task.status]?.color)} variant="secondary">
                                {statusLabels[task.status]?.label}
                              </Badge>
                              {task.area && (
                                <span className="text-[10px]">{getCelulaLabel(task.area)}</span>
                              )}
                            </div>
                          </div>
                          <ArrowRight className="h-3 w-3 shrink-0 opacity-40" />
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </section>

        {assignedSteps.length > 0 && (
          <section className="animate-fade-in surface-toolbar p-4">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Mis pasos de proyecto asignados</h2>
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">{assignedSteps.length}</span>
            </div>
            <div className="space-y-1">
              {assignedSteps.slice(0, showAllSteps ? undefined : 10).map((step) => {
                const isOverdue = isPastDueCalendarMX(step.dueDate);
                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-3 text-sm cursor-pointer rounded-lg px-3 py-2.5 card-hover-subtle border border-transparent",
                      isOverdue && "bg-destructive/5 border-destructive/10"
                    )}
                    onClick={() => navigate(`/proyectos/${step.projectId}?tab=${step.sourceType === "contabilidad" ? "contabilidad" : step.sourceType === "declaracion_anual" ? "declaracion_anual" : step.sourceType === "juicio" ? "juicio" : step.sourceType === "gestoria" ? "gestoria" : "general"}&step=${step.stepKey}`)}
                  >
                    <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">{step.sourceLabel}</span>
                    <span className="flex-1 truncate text-sm font-medium text-foreground">{step.stepLabel}</span>
                    {step.isCollaborator && (
                      <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">Colaborador</span>
                    )}
                    {step.clientName && (
                      <span className="text-xs text-muted-foreground shrink-0">{step.clientName}</span>
                    )}
                    {step.dueDate && (
                      <span className={cn(
                        "text-xs shrink-0 flex items-center gap-1",
                        isOverdue ? "text-destructive font-medium" : "text-muted-foreground"
                      )}>
                        <Calendar className="h-3 w-3" />
                        {formatMX(step.dueDate, "dd MMM")}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                      {stepStatusLabels[step.status] || step.status}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  </div>
                );
              })}
              {assignedSteps.length > 10 && !showAllSteps && (
                <button
                  onClick={() => setShowAllSteps(true)}
                  className="text-xs text-primary hover:text-primary/80 text-center py-1 w-full transition-colors"
                >
                  +{assignedSteps.length - 10} pasos más — ver todos
                </button>
              )}
              {showAllSteps && assignedSteps.length > 10 && (
                <button
                  onClick={() => setShowAllSteps(false)}
                  className="text-xs text-muted-foreground hover:text-foreground text-center py-1 w-full transition-colors"
                >
                  Mostrar menos
                </button>
              )}
            </div>
          </section>
        )}

        <div className="surface-toolbar space-y-3 p-4">
          <ScrollableFilterTabs
            options={[{ value: "todas", label: "Todas" }, ...areaOptions]}
            value={area}
            onChange={setArea}
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="relative flex-1 min-w-0 max-w-md">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar tareas..."
                className="pl-9 h-9 text-sm bg-background/60 border border-border/50 focus-visible:ring-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <TaskFiltersDrawer
                filters={advFilters}
                onChange={setAdvFilters}
                onClear={clearAdvFilters}
                activeCount={advActiveCount}
              />
              <Button
                type="button"
                size="sm"
                variant={vistaTareas === "historial" ? "default" : "outline"}
                className="h-9 text-xs shrink-0"
                onClick={() =>
                  setVistaTareasAndUrl(vistaTareas === "historial" ? "activas" : "historial")
                }
              >
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                Historial
                <span className="ml-1.5 tabular-nums opacity-80">({closedTasks.length})</span>
              </Button>
            </div>
          </div>

          {vistaTareas === "activas" && (
            <TaskStatusTabs
              value={statusFilter}
              onChange={setStatusFilter}
              counts={statusCounts}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : vistaTareas === "activas" ? (
          filteredOpenTasks.length > 0 ? (
            viewMode === "kanban" ? (
              <TaskKanbanBoard
                tasks={filteredOpenTasks}
                areaColorMap={areaColorMap}
                profileMap={profileMap}
                getCelulaLabel={getCelulaLabel}
                onOpen={openTask}
              />
            ) : viewMode === "timeline" ? (
              <TaskTimelineView
                tasks={filteredOpenTasks}
                profileMap={profileMap}
                onOpen={openTask}
              />
            ) : (
              <TaskGroupedList
                tasks={filteredOpenTasks}
                areaColorMap={areaColorMap}
                profileMap={profileMap}
                getCelulaLabel={getCelulaLabel}
                onOpen={openTask}
                onDelete={canDeleteTasks ? (t) => setDeleteTarget({ id: t.id, title: t.title }) : undefined}
                canDelete={canDeleteTasks}
              />
            )
          ) : (
            <div className="text-center py-16 animate-scale-in">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <CheckSquare className="h-8 w-8 text-primary/60" />
              </div>
              <h3 className="text-sm font-medium text-foreground">
                {tasks && tasks.length > 0
                  ? statusFilter === "todas" && advActiveCount === 0
                    ? "Nada en curso"
                    : "Sin resultados con estos filtros"
                  : "Sin tareas aún"}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                {tasks && tasks.length > 0 && (statusFilter !== "todas" || advActiveCount > 0)
                  ? "Ajusta los filtros o cambia de pestaña para ver más tareas."
                  : tasks && tasks.length > 0 && closedTasks.length > 0
                    ? "Todas las tareas visibles están completadas o canceladas. Revísalas en Historial."
                    : "Crea tu primera tarea para comenzar a organizar el trabajo del equipo."}
              </p>
              {advActiveCount > 0 ? (
                <Button type="button" className="mt-4" size="sm" variant="outline" onClick={clearAdvFilters}>
                  Limpiar filtros
                </Button>
              ) : tasks && tasks.length > 0 && closedTasks.length > 0 ? (
                <Button type="button" className="mt-4" size="sm" variant="outline" onClick={() => setVistaTareasAndUrl("historial")}>
                  <Archive className="mr-1.5 h-3.5 w-3.5" /> Ver historial ({closedTasks.length})
                </Button>
              ) : (
                <Button type="button" className="mt-4" size="sm" onClick={() => openNewTaskModal()}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Crear tarea
                </Button>
              )}
            </div>
          )
        ) : closedTasks.length > 0 ? (
          <div className="space-y-2">
            {closedTasks.map((task, i) => (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-4 py-3 px-4 page-list-card cursor-pointer animate-fade-in opacity-90 hover:opacity-100 border-border/60 bg-muted/20",
                  task.status === "cancelada" && "border-dashed"
                )}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms`, animationFillMode: "both" }}
                onClick={() => openTask(task)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={cn("text-sm font-medium truncate text-muted-foreground", task.status === "cancelada" && "line-through")}>
                      {task.title}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={cn("text-[10px] border-0 px-1.5 py-0", statusLabels[task.status]?.color)} variant="secondary">
                      {statusLabels[task.status]?.label}
                    </Badge>
                    {task.area && <span className="text-xs text-muted-foreground">{getCelulaLabel(task.area)}</span>}
                    {task.assigned_to && profileMap.get(task.assigned_to) && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />{profileMap.get(task.assigned_to)}
                      </span>
                    )}
                    {(task as any).clients?.name && (
                      <span className="text-xs text-muted-foreground/70">{(task as any).clients.name}</span>
                    )}
                    {(task as any).projects?.name && <span className="text-xs text-muted-foreground">{(task as any).projects.name}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0 text-[10px] text-muted-foreground">
                  {(task as any).completed_at && task.status === "completada" && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatMX((task as any).completed_at, "dd MMM yyyy")}
                    </span>
                  )}
                  {task.due_date && (
                    <span className="flex items-center gap-1 opacity-80">
                      Vence: {formatMX(task.due_date, "dd MMM")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-14">
            <Archive className="mx-auto h-9 w-9 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No hay tareas completadas ni canceladas en esta vista.</p>
            <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setVistaTareasAndUrl("activas")}>
              Volver a En curso
            </Button>
          </div>
        )}
      </div>

      <TaskDetailDialog taskId={selectedTaskId} onClose={closeTask} />
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar tarea "${deleteTarget?.title}"?`}
        description="Se eliminará la tarea permanentemente junto con sus comentarios y asignaciones."
        onConfirm={async () => { if (deleteTarget) { await deleteTask.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
        isPending={deleteTask.isPending}
      />
    </AppLayout>
  );
};

export default Tareas;
