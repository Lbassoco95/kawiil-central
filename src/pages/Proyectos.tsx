import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { FolderKanban, Scale, Sparkles, Search, Trash2 } from "lucide-react";
import { MeetingMinutesDialog } from "@/components/projects/MeetingMinutesDialog";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { useProjects, useDeleteProject } from "@/hooks/useProjects";
import { ProjectCreationDialog } from "@/components/projects/ProjectCreationDialog";
import { LawsuitFormDialog } from "@/components/projects/LawsuitFormDialog";
import { AiHeroV24 } from "@/components/dashboard/AiHeroV24";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useState, useMemo } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  formatDateMX,
  toDateStringMX,
  mexicoDayRangeISO,
  nowMX,
} from "@/lib/dateUtils";
import { PROJECT_STATUS_CONFIG } from "@/lib/statusStyles";

type ProjectStatus = Database["public"]["Enums"]["project_status"];
type StatusFilterTab = "activo" | "pausado" | "completado" | "todos";
type SortKey = "activity" | "client" | "progress";

const STATUS_LABELS: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.label]),
) as Record<ProjectStatus, string>;

const CHUNK = 90;

function projectPriorityClass(p: any): string {
  const crit = p.criticality_level;
  const delay = p.delay_category;
  if (crit === "critico") return "prio-urgent";
  if (crit === "atencion" || delay === "retrasado") return "prio-high";
  if (p.status === "pausado") return "prio-medium";
  return "prio-low";
}

function projectStatusDot(status: ProjectStatus | string): string {
  switch (status) {
    case "activo":
      return "s-activo";
    case "pausado":
      return "s-pausa";
    case "completado":
      return "s-complet";
    case "cancelado":
      return "s-pendiente";
    default:
      return "s-pendiente";
  }
}

function avatarClassForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const n = ((h % 5) + 5) % 5;
  return `av-${n + 1}`;
}

function initialsFromName(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return ((first + last) || name[0] || "?").toUpperCase();
}

function monthAbbr(month1: number): string {
  const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return names[(month1 - 1 + 12) % 12];
}

function formatLimitCell(
  ymd: string | null | undefined,
  todayYmd: string,
): { label: string; className: string } {
  if (!ymd) return { label: "—", className: "cell-muted" };
  if (ymd < todayYmd) {
    const [, m, d] = ymd.split("-");
    return {
      label: `Venció ${parseInt(d, 10)} ${monthAbbr(parseInt(m, 10))}`,
      className: "cell-date overdue",
    };
  }
  const [, m, d] = ymd.split("-");
  const label = `${parseInt(d, 10)} ${monthAbbr(parseInt(m, 10))}`;
  const diffDays = Math.floor(
    (new Date(ymd).getTime() - new Date(todayYmd).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays <= 14) return { label, className: "cell-date soon" };
  return { label, className: "cell-date" };
}

function progressFillClass(pct: number, status: ProjectStatus | string): string {
  if (status === "pausado" || status === "cancelado") return "warn";
  if (pct < 33) return "warn";
  return "";
}

const Proyectos = () => {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const deleteProject = useDeleteProject();
  const { isAdminOrManager } = useUserRole();
  const { areaOptions, getCelulaLabel } = useAreaOptions();
  const { data: orgUsers = [] } = useOrgUsers();
  const [search, setSearch] = useState("");
  const [lawsuitOpen, setLawsuitOpen] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterTab>("activo");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("activity");

  const profileName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of orgUsers) m.set(u.user_id, u.full_name || u.user_id);
    return m;
  }, [orgUsers]);

  const today = useMemo(() => nowMX(), []);
  const todayYmd = useMemo(() => toDateStringMX(today), [today]);

  const byStatus = useMemo(() => {
    if (!projects) return [];
    if (statusFilter === "todos") return projects;
    return projects.filter((p) => p.status === statusFilter);
  }, [projects, statusFilter]);

  const narrowed = useMemo(() => {
    let result = byStatus;
    if (areaFilter !== "all") {
      result = result.filter((p) => (areaFilter === "sin_area" ? !p.area : p.area === areaFilter));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p as any).clients?.name?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [byStatus, areaFilter, search]);

  const narrowedIds = useMemo(() => narrowed.map((p) => p.id), [narrowed]);
  const narrowedKey = narrowedIds.slice().sort().join(",");

  const { data: taskRows = [] } = useQuery({
    queryKey: ["proyectos-task-stats", narrowedKey],
    enabled: narrowedIds.length > 0,
    queryFn: async () => {
      const all: { project_id: string | null; status: string }[] = [];
      for (let i = 0; i < narrowedIds.length; i += CHUNK) {
        const slice = narrowedIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("tasks")
          .select("project_id, status")
          .in("project_id", slice);
        if (error) throw error;
        all.push(...(data ?? []));
      }
      return all;
    },
  });

  const statsByProject = useMemo(() => {
    const m = new Map<string, { total: number; pending: number }>();
    for (const row of taskRows) {
      if (!row.project_id) continue;
      const cur = m.get(row.project_id) ?? { total: 0, pending: 0 };
      cur.total += 1;
      if (row.status !== "completada") cur.pending += 1;
      m.set(row.project_id, cur);
    }
    return m;
  }, [taskRows]);

  const projectPct = (projectId: string, status: ProjectStatus | string) => {
    if (status === "completado") return 100;
    const s = statsByProject.get(projectId);
    if (!s || s.total === 0) return 0;
    return Math.round(((s.total - s.pending) / s.total) * 100);
  };

  const sorted = useMemo(() => {
    const arr = [...narrowed];
    arr.sort((a, b) => {
      if (sortKey === "client") {
        const ca = ((a as any).clients?.name || "ZZZ").toLowerCase();
        const cb = ((b as any).clients?.name || "ZZZ").toLowerCase();
        if (ca !== cb) return ca.localeCompare(cb);
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
      if (sortKey === "progress") {
        const pa = projectPct(a.id, a.status);
        const pb = projectPct(b.id, b.status);
        if (pb !== pa) return pb - pa;
        return a.name.localeCompare(b.name);
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return arr;
  }, [narrowed, sortKey, statsByProject]);

  // ── Stats del hero ──────────────────────────────────────────
  const monthRange = useMemo(() => {
    const y = today.getFullYear();
    const m = today.getMonth();
    const firstYmd = toDateStringMX(new Date(y, m, 1));
    const nextFirstYmd = toDateStringMX(new Date(y, m + 1, 1));
    return {
      start: mexicoDayRangeISO(firstYmd).start,
      endExclusive: mexicoDayRangeISO(nextFirstYmd).start,
    };
  }, [today]);

  const { data: completedThisMonth } = useQuery({
    queryKey: ["proyectos-hero-completed-month", monthRange.start, monthRange.endExclusive],
    enabled: !!projects,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("status", "completado")
        .gte("updated_at", monthRange.start)
        .lt("updated_at", monthRange.endExclusive);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const heroStats = useMemo<Array<PageHeaderStat | false>>(() => {
    if (!projects) return [];
    const activos = projects.filter((p) => p.status === "activo");
    const internos = activos.filter((p) => !(p as any).client_id).length;
    const deCliente = activos.length - internos;

    const criticos = activos.filter((p) => (p as any).criticality_level === "critico").length;
    const enRiesgo = activos.filter((p) => {
      const crit = (p as any).criticality_level === "critico";
      const delay = (p as any).delay_category === "retrasado";
      const atencion = (p as any).criticality_level === "atencion";
      return crit || delay || atencion;
    }).length;
    const enTiempo = Math.max(activos.length - enRiesgo, 0);

    return [
      {
        label: "Activos",
        value: activos.length,
        sub:
          activos.length > 0
            ? `${deCliente} cliente · ${internos} internos`
            : "sin proyectos activos",
        tone: "default" as const,
      },
      {
        label: "En tiempo",
        value: enTiempo,
        sub: enTiempo > 0 ? "Sin riesgo de atraso" : "sin proyectos al día",
        tone: enTiempo > 0 ? ("success" as const) : ("default" as const),
      },
      {
        label: "En riesgo",
        value: enRiesgo,
        sub: enRiesgo > 0 ? "Atención antes de 7 días" : "sin alertas",
        tone: enRiesgo > 0 ? ("warning" as const) : ("default" as const),
      },
      {
        label: "Críticos",
        value: criticos,
        sub: criticos > 0 ? "Vencen esta semana" : "sin críticos",
        tone: criticos > 0 ? ("warning" as const) : ("default" as const),
      },
      completedThisMonth != null && {
        label: "Completados",
        value: completedThisMonth,
        sub: "Este mes",
        tone: "success" as const,
      },
    ];
  }, [projects, completedThisMonth]);

  // ── Conteos por status para pill-group ──────────────────────
  const counts = useMemo(() => {
    const base = projects ?? [];
    return {
      activo: base.filter((p) => p.status === "activo").length,
      pausado: base.filter((p) => p.status === "pausado").length,
      completado: base.filter((p) => p.status === "completado").length,
      todos: base.length,
    };
  }, [projects]);

  // ── Contexto AiHeroV24 ──────────────────────────────────────
  const aiCtx = useMemo(() => {
    const base = (projects ?? []) as any[];
    const activos = base.filter((p) => p.status === "activo");
    const enRiesgo = activos.filter(
      (p) => p.criticality_level === "critico" || p.delay_category === "retrasado",
    );
    const sinActividad = activos.filter((p) => {
      if (!p.updated_at) return false;
      const days = Math.floor(
        (Date.now() - new Date(p.updated_at).getTime()) / (24 * 60 * 60 * 1000),
      );
      return days >= 7;
    });
    const topRisk = enRiesgo.slice(0, 8).map((p) => ({
      id: p.id,
      name: p.name,
      client: p.clients?.name ?? null,
      criticality: p.criticality_level ?? null,
      delay: p.delay_category ?? null,
      progressPct:
        typeof p.progress_pct === "number" ? p.progress_pct : projectPct(p.id, p.status),
    }));
    return {
      activos: activos.length,
      enRiesgo: enRiesgo.length,
      sinActividad: sinActividad.length,
      total: base.length,
      topRisk,
    };
  }, [projects, statsByProject]);

  const areaCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of byStatus) {
      const key = p.area || "sin_area";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [byStatus]);

  return (
    <AppLayout>
      <div className="kwv24 space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          icon={<FolderKanban />}
          breadcrumb={["Kawiil OS", "Trabajo", "Proyectos"]}
          iconAccent="linear-gradient(135deg, hsl(270 70% 55%), hsl(310 70% 55%))"
          title="Proyectos"
          description="Trabajos por cliente o internos: contabilidad, PLD, softlanding, juicios y consultorías. Cada proyecto agrupa tareas, documentos, tiempo y finanzas."
          stats={heroStats}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setMinutesOpen(true)}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Desde minuta</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLawsuitOpen(true)}>
                <Scale className="mr-1.5 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Nuevo juicio</span>
              </Button>
              <ProjectCreationDialog />
            </>
          }
        />
        <LawsuitFormDialog open={lawsuitOpen} onOpenChange={setLawsuitOpen} />
        <MeetingMinutesDialog open={minutesOpen} onOpenChange={setMinutesOpen} />

        <AiHeroV24
          module="proyectos"
          ready={!!projects && !isLoading}
          ctx={aiCtx}
        />

        <div className="toolbar">
          <div className="search">
            <Search width={14} height={14} />
            <input
              placeholder="Buscar proyectos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="pill-group">
            <button
              type="button"
              className={statusFilter === "activo" ? "active" : ""}
              onClick={() => setStatusFilter("activo")}
            >
              Activos<span className="count">{counts.activo}</span>
            </button>
            <button
              type="button"
              className={statusFilter === "pausado" ? "active" : ""}
              onClick={() => setStatusFilter("pausado")}
            >
              Pausados<span className="count">{counts.pausado}</span>
            </button>
            <button
              type="button"
              className={statusFilter === "completado" ? "active" : ""}
              onClick={() => setStatusFilter("completado")}
            >
              Completados<span className="count">{counts.completado}</span>
            </button>
            <button
              type="button"
              className={statusFilter === "todos" ? "active" : ""}
              onClick={() => setStatusFilter("todos")}
            >
              Todos<span className="count">{counts.todos}</span>
            </button>
          </div>
          <div className="divider" />
          <select
            className="select"
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
          >
            <option value="all">Todas las áreas</option>
            {areaOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {areaCounts.get(o.value)
                  ? ` (${areaCounts.get(o.value)})`
                  : ""}
              </option>
            ))}
            {areaCounts.get("sin_area") ? (
              <option value="sin_area">
                Sin categoría ({areaCounts.get("sin_area")})
              </option>
            ) : null}
          </select>
          <select
            className="select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="activity">Ordenar: Última actividad</option>
            <option value="client">Cliente</option>
            <option value="progress">Progreso</option>
          </select>
        </div>

        <div className="mtable proyectos">
          <div className="thead">
            <div />
            <div>Proyecto</div>
            <div>Estado</div>
            <div>Responsable</div>
            <div>Progreso</div>
            <div>Límite</div>
            <div />
          </div>
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Cargando proyectos…
            </div>
          ) : sorted.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <FolderKanban className="mx-auto mb-2 h-6 w-6 opacity-40" />
              Sin proyectos con estos filtros.
            </div>
          ) : (
            sorted.map((project: any) => {
              const pct = projectPct(project.id, project.status);
              const clientName = project.clients?.name ?? null;
              const areaLabel = project.area ? getCelulaLabel(project.area) : null;
              const crit = project.criticality_level as string | null;
              const delay = project.delay_category as string | null;
              const responsibleId: string | null = project.responsible_user_id ?? null;
              const responsibleName = responsibleId
                ? profileName.get(responsibleId) ?? null
                : null;
              const avClass = responsibleId ? avatarClassForKey(responsibleId) : "";
              const initials = initialsFromName(responsibleName);
              const limit = formatLimitCell(project.end_date ?? null, todayYmd);
              const fillCls = progressFillClass(pct, project.status);
              return (
                <div
                  key={project.id}
                  className="trow"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/proyectos/${project.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/proyectos/${project.id}`);
                    }
                  }}
                >
                  <div className={`prio-dot ${projectPriorityClass(project)}`} />
                  <div className="tname">
                    <span className="title">{project.name}</span>
                    <div className="meta">
                      <span>{clientName ?? "Interno"}</span>
                      {areaLabel && (
                        <>
                          <span className="dot" />
                          <span>{areaLabel}</span>
                        </>
                      )}
                      {crit === "critico" && (
                        <>
                          <span className="dot" />
                          <span>
                            <span className="flag flag-critico">Crítico</span>
                          </span>
                        </>
                      )}
                      {crit === "atencion" && (
                        <>
                          <span className="dot" />
                          <span>
                            <span className="flag flag-atencion">Atención</span>
                          </span>
                        </>
                      )}
                      {delay === "retrasado" && crit !== "critico" && (
                        <>
                          <span className="dot" />
                          <span>
                            <span className="flag flag-retraso">Retraso</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="status-cell">
                    <span className={`status-dot ${projectStatusDot(project.status)}`} />
                    <span className="cell-text">{STATUS_LABELS[project.status]}</span>
                  </div>
                  {responsibleName ? (
                    <div className="assignee">
                      <span className={`avatar ${avClass}`}>{initials}</span>
                      <span className="name">{responsibleName}</span>
                    </div>
                  ) : (
                    <div className="assignee empty">
                      <span
                        className="avatar"
                        style={{ background: "hsl(var(--muted-foreground) / 0.3)" }}
                      >
                        ?
                      </span>
                      <span className="name">Sin responsable</span>
                    </div>
                  )}
                  <div className="progress-wrap">
                    <div className="progress-bar">
                      <div
                        className={`progress-fill ${fillCls}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="progress-num">{pct}%</span>
                  </div>
                  <div className={limit.className}>
                    {project.end_date
                      ? formatLimitCell(project.end_date, todayYmd).label
                      : formatDateMX(project.end_date ?? "") || "—"}
                  </div>
                  {isAdminOrManager ? (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Eliminar"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget({ id: project.id, name: project.name });
                      }}
                    >
                      <Trash2 width={13} height={13} />
                    </button>
                  ) : (
                    <div />
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="note">
          Columnas fijas (Estado · Responsable · Progreso · Límite) para escaneo vertical. Las banderas
          de criticidad van como chips en la misma fila, sin cards anidados.
        </div>
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar proyecto "${deleteTarget?.name}"?`}
        description="Se eliminará el proyecto permanentemente. Si tiene tareas asociadas, la eliminación podría fallar."
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteProject.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        isPending={deleteProject.isPending}
      />
    </AppLayout>
  );
};

export default Proyectos;
