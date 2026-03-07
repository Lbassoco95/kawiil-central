import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
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
type ServiceArea = Database["public"]["Enums"]["service_area"];

const STATUS_STYLES: Record<ProjectStatus, string> = {
  activo: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  pausado: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completado: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  cancelado: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  activo: "Activo",
  pausado: "Pausado",
  completado: "Completado",
  cancelado: "Cancelado",
};

const AREA_ORDER: string[] = [
  "contabilidad",
  "legal",
  "softlanding",
  "pld_ft",
  "cumplimiento",
  "juicios",
  "gestoria",
  "constitucion_nacional",
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

  // Get available areas from projects
  const availableAreas = useMemo(() => {
    if (!projects) return [];
    const areaSet = new Set<string>();
    for (const p of projects) {
      areaSet.add(p.area || "sin_area");
    }
    // Sort by AREA_ORDER
    return AREA_ORDER.filter((a) => areaSet.has(a)).concat(
      areaSet.has("sin_area") ? ["sin_area"] : []
    );
  }, [projects]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    let result = projects;
    // Filter by area
    if (selectedArea !== "all") {
      result = result.filter((p) =>
        selectedArea === "sin_area" ? !p.area : p.area === selectedArea
      );
    }
    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p as any).clients?.name?.toLowerCase().includes(q)
      );
    }
    // Sort alphabetically by client name, then project name
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
            <h1 className="text-2xl font-bold text-foreground">Proyectos</h1>
            <p className="text-sm text-muted-foreground">Proyectos por cliente o internos</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setLawsuitOpen(true)}>
              <Scale className="mr-2 h-4 w-4" />
              Nuevo juicio
            </Button>
            <ProjectFormDialog />
          </div>
          <LawsuitFormDialog open={lawsuitOpen} onOpenChange={setLawsuitOpen} />
        </div>

        {/* Area tabs */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={selectedArea === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedArea("all")}
            className="text-xs"
          >
            Todos
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {projects?.length || 0}
            </Badge>
          </Button>
          {availableAreas.map((area) => {
            const count = projects?.filter((p) =>
              area === "sin_area" ? !p.area : p.area === area
            ).length || 0;
            return (
              <Button
                key={area}
                variant={selectedArea === area ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedArea(area)}
                className="text-xs"
              >
                {getAreaLabel(area)}
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar proyectos..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-center text-muted-foreground py-8">Cargando...</p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <div className="text-center py-12">
                <FolderKanban className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-medium text-foreground">
                  {search || selectedArea !== "all" ? "Sin resultados" : "Sin proyectos aún"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {search || selectedArea !== "all"
                    ? "Intenta con otro filtro."
                    : "Crea tu primer proyecto para organizar tareas."}
                </p>
                {!search && selectedArea === "all" && <ProjectFormDialog />}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {filtered.map((project) => (
              <Card
                key={project.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/proyectos/${project.id}`)}
              >
                <CardContent className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground shrink-0 w-32 truncate">
                        {(project as any).clients?.name ?? "Interno"}
                      </span>
                      <h3 className="font-medium text-foreground text-sm truncate">
                        {project.name}
                      </h3>
                      {selectedArea === "all" && project.area && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {getAreaLabel(project.area)}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_STYLES[project.status]}`}>
                        {STATUS_LABELS[project.status]}
                      </Badge>
                    </div>
                    {isAdminOrManager && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: project.id, name: project.name }); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
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
