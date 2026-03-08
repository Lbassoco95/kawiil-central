import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, FolderKanban, Scale, Trash2 } from "lucide-react";
import { useProjects, useDeleteProject } from "@/hooks/useProjects";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { LawsuitFormDialog } from "@/components/projects/LawsuitFormDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useState, useMemo } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import type { Database } from "@/integrations/supabase/types";

type ProjectStatus = Database["public"]["Enums"]["project_status"];

const STATUS_STYLES: Record<ProjectStatus, string> = {
  activo: "bg-success/10 text-success",
  pausado: "bg-warning/10 text-warning",
  completado: "bg-primary/10 text-primary",
  cancelado: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  activo: "Activo",
  pausado: "Pausado",
  completado: "Completado",
  cancelado: "Cancelado",
};

const AREA_ORDER: string[] = [
  "contabilidad", "legal", "softlanding", "pld_ft",
  "cumplimiento", "juicios", "gestoria", "constitucion_nacional",
];

const Proyectos = () => {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const deleteProject = useDeleteProject();
  const { isAdminOrManager } = useUserRole();
  const { areaLabelMap } = useAreaOptions();
  const [search, setSearch] = useState("");
  const [lawsuitOpen, setLawsuitOpen] = useState(false);
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
    return areaLabelMap[slug] || slug;
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
            <Button variant="outline" size="sm" onClick={() => setLawsuitOpen(true)}>
              <Scale className="mr-1.5 h-3.5 w-3.5" />
              Nuevo juicio
            </Button>
            <ProjectFormDialog />
          </div>
          <LawsuitFormDialog open={lawsuitOpen} onOpenChange={setLawsuitOpen} />
        </div>

        {/* Area filter pills */}
        <div className="flex flex-wrap gap-1.5">
          {["all", ...availableAreas].map((area) => {
            const count = area === "all"
              ? projects?.length || 0
              : projects?.filter((p) => area === "sin_area" ? !p.area : p.area === area).length || 0;
            const isActive = selectedArea === area;
            return (
              <button
                key={area}
                onClick={() => setSelectedArea(area)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {getAreaLabel(area)}
                <span className={`text-[10px] ${isActive ? "opacity-80" : "opacity-60"}`}>{count}</span>
              </button>
            );
          })}
        </div>

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
          <p className="text-center text-muted-foreground py-12 text-sm">Cargando...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FolderKanban className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h3 className="mt-3 text-sm font-medium text-foreground">
              {search || selectedArea !== "all" ? "Sin resultados" : "Sin proyectos aún"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {search || selectedArea !== "all" ? "Intenta con otro filtro." : "Crea tu primer proyecto para organizar tareas."}
            </p>
            {!search && selectedArea === "all" && <div className="mt-3"><ProjectFormDialog /></div>}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between gap-3 py-3 px-1 hover:bg-secondary/30 rounded-lg transition-colors cursor-pointer -mx-1"
                onClick={() => navigate(`/proyectos/${project.id}`)}
              >
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground shrink-0 w-28 truncate">
                    {(project as any).clients?.name ?? "Interno"}
                  </span>
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {project.name}
                  </span>
                  {selectedArea === "all" && project.area && (
                    <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                      {getAreaLabel(project.area)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 ${STATUS_STYLES[project.status]}`}>
                    {STATUS_LABELS[project.status]}
                  </Badge>
                  {isAdminOrManager && (
                    <button
                      className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
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
