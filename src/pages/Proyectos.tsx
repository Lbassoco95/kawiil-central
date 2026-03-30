import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, FolderKanban, Scale, Trash2, Sparkles } from "lucide-react";
import { MeetingMinutesDialog } from "@/components/projects/MeetingMinutesDialog";
import { ScrollableFilterTabs } from "@/components/shared/ScrollableFilterTabs";
import { useProjects, useDeleteProject } from "@/hooks/useProjects";
import { ProjectCreationDialog } from "@/components/projects/ProjectCreationDialog";
import { LawsuitFormDialog } from "@/components/projects/LawsuitFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useState, useMemo } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import type { Database } from "@/integrations/supabase/types";

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

const Proyectos = () => {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const deleteProject = useDeleteProject();
  const { isAdminOrManager } = useUserRole();
  const { areaLabelMap, getCelulaLabel } = useAreaOptions();
  const [search, setSearch] = useState("");
  const [lawsuitOpen, setLawsuitOpen] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [selectedArea, setSelectedArea] = useState<string>("all");

  const availableAreas = useMemo(() => {
    if (!projects) return [];
    const areaSet = new Set<string>();
    for (const p of projects) areaSet.add(p.area || "sin_area");
    return AREA_ORDER.filter((a) => areaSet.has(a)).concat(areaSet.has("sin_area") ? ["sin_area"] : []);
  }, [projects]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    let result = projects;
    if (selectedArea !== "all") {
      result = result.filter((p) => selectedArea === "sin_area" ? !p.area : p.area === selectedArea);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || (p as any).clients?.name?.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const clientA = ((a as any).clients?.name || "ZZZ").toLowerCase();
      const clientB = ((b as any).clients?.name || "ZZZ").toLowerCase();
      if (clientA !== clientB) return clientA.localeCompare(clientB);
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return result;
  }, [projects, selectedArea, search]);

  const getAreaLabel = (slug: string) => {
    if (slug === "all") return "Todos";
    if (slug === "sin_area") return "Sin categoría";
    return getCelulaLabel(slug);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Proyectos</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Proyectos por cliente o internos</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMinutesOpen(true)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Desde minuta</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLawsuitOpen(true)}>
              <Scale className="mr-1.5 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Nuevo juicio</span>
            </Button>
            <ProjectCreationDialog />
          </div>
          <LawsuitFormDialog open={lawsuitOpen} onOpenChange={setLawsuitOpen} />
          <MeetingMinutesDialog open={minutesOpen} onOpenChange={setMinutesOpen} />
        </div>

        <ScrollableFilterTabs
          options={["all", ...availableAreas].map((area) => ({
            value: area,
            label: getAreaLabel(area),
            count: area === "all"
              ? projects?.length || 0
              : projects?.filter((p) => area === "sin_area" ? !p.area : p.area === area).length || 0,
          }))}
          value={selectedArea}
          onChange={setSelectedArea}
        />

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar proyectos..."
            className="pl-9 h-9 text-sm bg-secondary/30 border-0 focus-visible:ring-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-secondary/30 animate-pulse" />
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
              {search || selectedArea !== "all" ? "Intenta con otro filtro." : "Crea tu primer proyecto para organizar tareas."}
            </p>
            {!search && selectedArea === "all" && <div className="mt-4"><ProjectCreationDialog /></div>}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((project, i) => (
              <div
                key={project.id}
                className={cn(
                  "flex items-center gap-4 py-3 px-4 rounded-xl border bg-card card-hover cursor-pointer animate-fade-in",
                  (project as any).delay_category && "bg-warning/[0.03] border-warning/20"
                )}
                style={{ animationDelay: `${Math.min(i, 10) * 30}ms`, animationFillMode: "both" }}
                onClick={() => navigate(`/proyectos/${project.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(project as any).clients?.name ?? "Interno"}
                    </span>
                    {selectedArea === "all" && project.area && (
                      <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                        {getAreaLabel(project.area)}
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-foreground truncate">{project.name}</h3>
                  {/* Inline progress bar */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden max-w-[200px]">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-500"
                        style={{ width: `${project.status === "completado" ? 100 : project.status === "activo" ? 50 : project.status === "en_pausa" ? 30 : 10}%` }}
                      />
                    </div>
                    <Badge variant="outline" className={cn("text-[10px] border-0 px-1.5 py-0", STATUS_STYLES[project.status])}>
                      {STATUS_LABELS[project.status]}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(project as any).criticality_level === "critico" && <span title="Crítico">🔴</span>}
                  {(project as any).criticality_level === "atencion" && <span title="Atención">🟡</span>}
                  {isAdminOrManager && (
                    <button
                      className="p-1 rounded text-muted-foreground/30 hover:text-destructive transition-colors"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: project.id, name: project.name }); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
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
