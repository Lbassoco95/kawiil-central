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
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { toast } from "sonner";
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

type StatusFilter = "mias" | "equipo" | "vencidas" | "sin_resp";
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("mias");
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

  // Selección múltiple para acciones en lote.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelected = (taskId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());
  const setAllSelected = (ids: string[], on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });

  const bulkSetStatus = async (status: string) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await updateTask.mutateAsync({ id, status } as any);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    clearSelection();
    if (fail === 0) toast.success(`${ok} tarea(s) actualizada(s)`);
    else toast.warning(`${ok} actualizada(s), ${fail} no se pudieron (revisa subtareas abiertas)`);
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`¿Eliminar ${ids.length} tarea(s)? Esta acción no se puede deshacer.`)) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await deleteTask.mutateAsync(id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    clearSelection();
    if (fail === 0) toast.success(`${ok} tarea(s) eliminada(s)`);
    else toast.warning(`${ok} eliminada(s), ${fail} no se pudieron`);
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

  const isBlocked = (t: any) =>
    Boolean(t.is_blocked) || t.status === "bloqueada" || t.delay_category === "bloqueada";

  /**
   * Universo "equipo/organización": todas las tareas visibles (incluye subtareas) tras aplicar
   * el filtro de célula y la búsqueda (que ya se resuelven en el servidor dentro de useTasks).
   */
  const orgOpen = useMemo(
    () => (tasks as any[]).filter((t) => !isTaskClosedStatus(t.status)),
    [tasks],
  );

  /**
   * Universo "mías": exactamente la misma fuente que el dashboard personal
   * (useMyAssignedTasks → assigned_to = yo, subtareas incluidas). Se filtra en cliente por
   * célula y búsqueda para que los controles de la barra también apliquen a esta vista.
   */
  const mineOpen = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (myAssignedRaw as any[])
      .filter((t) => !isTaskClosedStatus(t.status))
      .filter((t) => (celula !== "todas" ? t.area === celula : true))
      .filter((t) => (q ? (t.title ?? "").toLowerCase().includes(q) : true));
  }, [myAssignedRaw, celula, search]);

  const mineOverdue = useMemo(
    () => mineOpen.filter((t) => t.due_date && isPastDueCalendarMX(t.due_date)),
    [mineOpen],
  );

  const closedTasks = useMemo(() => {
    const list = (tasks as any[]).filter((t) => isTaskClosedStatus(t.status));
    return [...list].sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at).getTime() -
        new Date(a.updated_at || a.created_at).getTime(),
    );
  }, [tasks]);

  // Conteos operativos (personales por defecto, para que coincidan con el dashboard).
  const overdueCount = mineOverdue.length;
  const dueThisWeekCount = useMemo(
    () =>
      mineOpen.filter((t) => {
        if (!t.due_date) return false;
        if (isPastDueCalendarMX(t.due_date)) return false;
        return t.due_date <= in7Ymd;
      }).length,
    [mineOpen, in7Ymd],
  );
  const blockedCount = useMemo(() => mineOpen.filter(isBlocked).length, [mineOpen]);
  const sinRespCount = useMemo(
    () => orgOpen.filter((t) => !t.assigned_to).length,
    [orgOpen],
  );
  const miasCount = mineOpen.length;
  const equipoCount = orgOpen.length;

  // ── Filtro de pills + ordenamiento ──────────────────────────
  const filteredOpen = useMemo(() => {
    let list: any[];
    switch (statusFilter) {
      case "equipo":
        list = orgOpen;
        break;
      case "vencidas":
        list = mineOverdue;
        break;
      case "sin_resp":
        list = orgOpen.filter((t) => !t.assigned_to);
        break;
      case "mias":
      default:
        list = mineOpen;
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
  }, [orgOpen, mineOpen, mineOverdue, statusFilter, orden, user?.id, profileMap]);

  // ── Stats del hero ──────────────────────────────────────────
  // Todos los indicadores son PERSONALES (mías, subtareas incluidas) para que coincidan
  // exactamente con el dashboard. El total del equipo se muestra como contexto secundario.
  const heroStats = useMemo<Array<PageHeaderStat | false>>(() => {
    return [
      {
        label: "En curso",
        value: miasCount,
        sub: `${equipoCount} en el equipo`,
        tone: "default" as const,
      },
      {
        label: "Vencidas",
        value: overdueCount,
        sub: overdueCount > 0 ? "Requieren atención" : "Sin atrasos",
        tone: overdueCount > 0 ? ("warning" as const) : ("default" as const),
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
  }, [miasCount, equipoCount, overdueCount, dueThisWeekCount, completedTodayCount, blockedCount]);

  // ── Contexto para AiHeroV24 ─────────────────────────────────
  const topCritical = useMemo(
    () =>
      orgOpen
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
    [orgOpen, todayYmd],
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
            tasksCount: miasCount,
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
            <div className="num">{miasCount}</div>
            <div className="sub">{equipoCount} en el equipo</div>
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
              className={statusFilter === "mias" ? "active" : ""}
              onClick={() => setStatusFilter("mias")}
            >
              Mías<span className="count">{miasCount}</span>
            </button>
            <button
              type="button"
              className={statusFilter === "equipo" ? "active" : ""}
              onClick={() => setStatusFilter("equipo")}
            >
              Equipo<span className="count">{equipoCount}</span>
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

        {/* Barra de acciones en lote */}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-medium">
              {selectedIds.size} seleccionada{selectedIds.size === 1 ? "" : "s"}
            </span>
            <span className="mx-1 h-4 w-px bg-border" />
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={bulkBusy}
              onClick={() => void bulkSetStatus("completada")}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Completar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-destructive hover:text-destructive"
              disabled={bulkBusy}
              onClick={() => void bulkSetStatus("cancelada")}
            >
              Cancelar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8" disabled={bulkBusy}>
                  Cambiar estatus ▾
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {Object.entries(statusLabels).map(([key, { label }]) => (
                  <DropdownMenuItem key={key} onSelect={() => void bulkSetStatus(key)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {canDeleteTasks && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-destructive hover:text-destructive"
                disabled={bulkBusy}
                onClick={() => void bulkDelete()}
              >
                <Trash2 className="h-3.5 w-3.5" /> Eliminar
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-8"
              disabled={bulkBusy}
              onClick={clearSelection}
            >
              Limpiar
            </Button>
          </div>
        )}

        {/* TABLA */}
        {vista === "activas" ? (
          <div className="mtable-scroll">
          <div className="mtable tareas">
            <div className="thead">
              <div />
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={
                    filteredOpen.length > 0 &&
                    filteredOpen.every((t) => selectedIds.has(t.id))
                  }
                  onCheckedChange={(v) =>
                    setAllSelected(
                      filteredOpen.map((t) => t.id),
                      !!v,
                    )
                  }
                  aria-label="Seleccionar todas"
                />
                Tarea
              </div>
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
                const isSubtask = Boolean((task as any).is_subtask);
                const parentTask = (task as any).parent_task ?? null;
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
                      <div className="flex items-start gap-2 min-w-0">
                        <span
                          role="checkbox"
                          aria-checked={selectedIds.has(task.id)}
                          aria-label="Seleccionar tarea"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelected(task.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSelected(task.id);
                            }
                          }}
                          className="flex shrink-0 cursor-pointer items-start p-2 -m-2"
                        >
                          <Checkbox
                            checked={selectedIds.has(task.id)}
                            tabIndex={-1}
                            aria-hidden
                            className="pointer-events-none mt-0.5"
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="title">
                            {isSubtask && (
                              <span
                                className="flag"
                                style={{ background: "hsl(var(--muted))", marginRight: 6 }}
                                title="Subtarea"
                              >
                                ↳ Subtarea
                              </span>
                            )}
                            {task.title}
                          </span>
                          <div className="meta">
                            {isSubtask && parentTask?.id && (
                              <>
                                <button
                                  type="button"
                                  className="underline-offset-2 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openTask({ id: parentTask.id, project_id: (task as any).project_id });
                                  }}
                                  title="Abrir tarea principal"
                                >
                                  Tarea principal: {parentTask.title ?? "ver"}
                                </button>
                                <span className="dot" />
                              </>
                            )}
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
          </div>
        ) : (
          <div className="mtable-scroll">
          <div className="mtable tareas">
            <div className="thead">
              <div />
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={closedTasks.length > 0 && closedTasks.every((t: any) => selectedIds.has(t.id))}
                  onCheckedChange={(v) =>
                    setAllSelected(
                      closedTasks.map((t: any) => t.id),
                      !!v,
                    )
                  }
                  aria-label="Seleccionar todas"
                />
                Tarea
              </div>
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
                      <div className="flex items-start gap-2 min-w-0">
                        <span
                          role="checkbox"
                          aria-checked={selectedIds.has(task.id)}
                          aria-label="Seleccionar tarea"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelected(task.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSelected(task.id);
                            }
                          }}
                          className="flex shrink-0 cursor-pointer items-start p-2 -m-2"
                        >
                          <Checkbox
                            checked={selectedIds.has(task.id)}
                            tabIndex={-1}
                            aria-hidden
                            className="pointer-events-none mt-0.5"
                          />
                        </span>
                        <div className="min-w-0 flex-1">
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
          </div>
        )}

        {/* Pasos de proyecto asignados a ti */}
        {assignedSteps.length > 0 && (
          <details className="collapsible" open={false}>
            <summary>
              Pasos de proyecto asignados a ti
              <span className="count-pill">{assignedSteps.length}</span>
            </summary>
            <div className="body" style={{ padding: "8px 0 0", overflowX: "auto" }}>
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
                      gridTemplateColumns: "130px minmax(160px, 1fr) 120px 90px",
                      gap: 12,
                      alignItems: "center",
                      fontSize: 12.5,
                      cursor: "pointer",
                      minWidth: 520,
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
