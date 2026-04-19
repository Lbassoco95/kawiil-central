import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, FolderKanban, Scale, Trash2, Sparkles } from "lucide-react";
import { MeetingMinutesDialog } from "@/components/projects/MeetingMinutesDialog";
import { ScrollableFilterTabs } from "@/components/shared/ScrollableFilterTabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { useProjects, useDeleteProject } from "@/hooks/useProjects";
import { ProjectCreationDialog } from "@/components/projects/ProjectCreationDialog";
import { LawsuitFormDialog } from "@/components/projects/LawsuitFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useState, useMemo } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateMX } from "@/lib/dateUtils";

type ProjectStatus = Database["public"]["Enums"]["project_status"];

import { PROJECT_STATUS_CONFIG } from "@/lib/statusStyles";

const STATUS_STYLES: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.color])
) as Record<ProjectStatus, string>;

const STATUS_LABELS: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<ProjectStatus, string>;

const AREA_ORDER: string[] = [
  "contabilidad", "legal", "softlanding", "pld_ft",
  "cumplimiento", "juicios", "gestoria", "constitucion_nacional",
];

type StatusFilterTab = "activo" | "completado" | "pausado" | "todos";
type SortKey = "activity" | "name" | "created_at" | "progress";

const CHUNK = 90;

const Proyectos = () => {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const deleteProject = useDeleteProject();
  const { isAdminOrManager } = useUserRole();
  const { getCelulaLabel } = useAreaOptions();
  const { data: orgUsers = [] } = useOrgUsers();
  const [search, setSearch] = useState("");
  const [lawsuitOpen, setLawsuitOpen] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterTab>("activo");
  const [sortKey, setSortKey] = useState<SortKey>("activity");

  const profileName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of orgUsers) {
      m.set(u.user_id, u.full_name || u.user_id);
    }
    return m;
  }, [orgUsers]);

  const projectsByStatus = useMemo(() => {
    if (!projects) return [];
    if (statusFilter === "todos") return projects;
    return projects.filter((p) => p.status === statusFilter);
  }, [projects, statusFilter]);

  const availableAreas = useMemo(() => {
    if (!projectsByStatus.length) return [];
    const areaSet = new Set<string>();
    for (const p of projectsByStatus) areaSet.add(p.area || "sin_area");
    return AREA_ORDER.filter((a) => areaSet.has(a)).concat(areaSet.has("sin_area") ? ["sin_area"] : []);
  }, [projectsByStatus]);

  const narrowedIds = useMemo(() => {
    let result = projectsByStatus;
    if (selectedArea !== "all") {
      result = result.filter((p) => (selectedArea === "sin_area" ? !p.area : p.area === selectedArea));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || (p as any).clients?.name?.toLowerCase().includes(q),
      );
    }
    return result.map((p) => p.id);
  }, [projectsByStatus, selectedArea, search]);

  const narrowedIdsKey = narrowedIds.slice().sort().join(",");

  const { data: taskRows = [] } = useQuery({
    queryKey: ["proyectos-task-stats", narrowedIdsKey],
    enabled: narrowedIds.length > 0,
    queryFn: async () => {
      const all: { project_id: string | null; status: string }[] = [];
      for (let i = 0; i < narrowedIds.length; i += CHUNK) {
        const slice = narrowedIds.slice(i, i + CHUNK);
        const { data, error } = await supabase.from("tasks").select("project_id, status").in("project_id", slice);
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

  const filtered = useMemo(() => {
    const pct = (projectId: string) => {
      const s = statsByProject.get(projectId);
      if (!s || s.total === 0) return 0;
      return Math.round(((s.total - s.pending) / s.total) * 100);
    };
    if (!projects) return [];
    let result = projectsByStatus;
    if (selectedArea !== "all") {
      result = result.filter((p) => (selectedArea === "sin_area" ? !p.area : p.area === selectedArea));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || (p as any).clients?.name?.toLowerCase().includes(q),
      );
    }
    const arr = [...result];
    arr.sort((a, b) => {
      if (sortKey === "name") {
        const clientA = ((a as any).clients?.name || "ZZZ").toLowerCase();
        const clientB = ((b as any).clients?.name || "ZZZ").toLowerCase();
        if (clientA !== clientB) return clientA.localeCompare(clientB);
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
      if (sortKey === "created_at") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortKey === "activity") {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
      const pa = pct(a.id);
      const pb = pct(b.id);
      if (pb !== pa) return pb - pa;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [projects, projectsByStatus, selectedArea, search, sortKey, statsByProject]);

  const getAreaLabel = (slug: string) => {
    if (slug === "all") return "Todos";
    if (slug === "sin_area") return "Sin categoría";
    return getCelulaLabel(slug);
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          variant="minimal"
          title="Proyectos"
          description="Proyectos por cliente o internos"
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

        <div className="surface-toolbar space-y-4 p-4">
        <div className="flex flex-wrap gap-2 items-center">
          {(
            [
              { k: "activo" as const, label: "Activos" },
              { k: "completado" as const, label: "Completados" },
              { k: "pausado" as const, label: "Pausados" },
              { k: "todos" as const, label: "Todos" },
            ] as const
          ).map(({ k, label }) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={statusFilter === k ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setStatusFilter(k)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <ScrollableFilterTabs
            options={["all", ...availableAreas].map((area) => ({
              value: area,
              label: getAreaLabel(area),
              count:
                area === "all"
                  ? projectsByStatus.length
                  : projectsByStatus.filter((p) => (area === "sin_area" ? !p.area : p.area === area)).length,
            }))}
            value={selectedArea}
            onChange={setSelectedArea}
          />
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-[220px] h-9 text-xs">
              <SelectValue placeholder="Ordenar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="activity">Última actividad</SelectItem>
              <SelectItem value="name">Nombre / cliente</SelectItem>
              <SelectItem value="created_at">Fecha de creación</SelectItem>
              <SelectItem value="progress">Progreso (tareas)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar proyectos..."
            className="pl-9 h-9 text-sm bg-background/60 border border-border/50 focus-visible:ring-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 animate-scale-in">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <FolderKanban className="h-8 w-8 text-primary/60" />
            </div>
            <h3 className="text-sm font-medium text-foreground">
              {search || selectedArea !== "all" ? "Sin resultados" : "Sin proyectos aún"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
              {search || selectedArea !== "all" || statusFilter !== "activo"
                ? "Intenta con otro filtro."
                : "Crea tu primer proyecto para organizar tareas."}
            </p>
            {!search && selectedArea === "all" && statusFilter === "activo" && (
              <div className="mt-4">
                <ProjectCreationDialog />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((project, i) => {
              const stats = statsByProject.get(project.id);
              const pct = project.status === "completado"
                ? 100
                : !stats || stats.total === 0
                  ? 0
                  : Math.round(((stats.total - stats.pending) / stats.total) * 100);
              const barColor =
                project.status === "completado"
                  ? "bg-green-600"
                  : project.status === "pausado"
                    ? "bg-amber-500"
                    : project.status === "cancelado"
                      ? "bg-muted-foreground/40"
                      : "bg-accent";
              return (
                <div
                  key={project.id}
                  className={cn(
                    "grid grid-cols-12 gap-4 items-center py-4 px-4 page-list-card cursor-pointer animate-fade-in",
                    (project as any).delay_category && "bg-warning/[0.03] border-warning/20",
                  )}
                  style={{ animationDelay: `${Math.min(i, 10) * 30}ms`, animationFillMode: "both" }}
                  onClick={() => navigate(`/proyectos/${project.id}`)}
                >
                  {/* Col 1-6: cliente + nombre + meta */}
                  <div className="col-span-12 md:col-span-6 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs text-muted-foreground shrink-0">
                        {(project as any).clients?.name ?? "Interno"}
                      </span>
                      {selectedArea === "all" && project.area && (
                        <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                          {getAreaLabel(project.area)}
                        </span>
                      )}
                      {(project as any).criticality_level === "critico" && <span title="Crítico" className="text-[10px]">🔴</span>}
                      {(project as any).criticality_level === "atencion" && <span title="Atención" className="text-[10px]">🟡</span>}
                    </div>
                    <h3 className="text-sm font-medium text-foreground truncate">{project.name}</h3>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {project.responsible_user_id ? (
                        <span>
                          Resp.:{" "}
                          <span className="text-foreground font-medium">
                            {profileName.get(project.responsible_user_id) ?? "—"}
                          </span>
                        </span>
                      ) : null}
                      {project.end_date ? (
                        <span>
                          Límite: <span className="text-foreground">{formatDateMX(project.end_date)}</span>
                        </span>
                      ) : null}
                      {!stats || stats.total === 0 ? (
                        <span>Sin tareas</span>
                      ) : (
                        <span>
                          Tareas:{" "}
                          <span className="text-foreground font-medium">
                            {stats.pending}/{stats.total} pend.
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Col 7-10: progreso con label */}
                  <div className="col-span-8 md:col-span-4 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                      <span className="uppercase tracking-wider">Progreso</span>
                      <span className="tabular-nums text-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", barColor)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Col 11-12: status + trash */}
                  <div className="col-span-4 md:col-span-2 flex items-center justify-end gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] border-0 px-1.5 py-0", STATUS_STYLES[project.status])}
                    >
                      {STATUS_LABELS[project.status]}
                    </Badge>
                    {isAdminOrManager && (
                      <button
                        className="p-1 rounded text-muted-foreground/30 hover:text-destructive transition-colors"
                        aria-label={`Eliminar ${project.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ id: project.id, name: project.name });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`¿Eliminar proyecto "${deleteTarget?.name}"?`}
        description="Se eliminará el proyecto permanentemente. Si tiene tareas asociadas, la eliminación podría fallar."
        onConfirm={async () => { if (deleteTarget) { await deleteProject.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
        isPending={deleteProject.isPending}
      />
    </AppLayout>
  );
};

export default Proyectos;
