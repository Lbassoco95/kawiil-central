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
import type { Database } from "@/integrations/supabase/types";

type ProjectStatus = Database["public"]["Enums"]["project_status"];
type ServiceArea = Database["public"]["Enums"]["service_area"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";

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

const Proyectos = () => {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useProjects();
  const deleteProject = useDeleteProject();
  const [search, setSearch] = useState("");
  const [lawsuitOpen, setLawsuitOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const filtered = useMemo(() => {
    if (!projects) return [];
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p as any).clients?.name?.toLowerCase().includes(q)
    );
  }, [projects, search]);

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
                  {search ? "Sin resultados" : "Sin proyectos aún"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {search
                    ? "Intenta con otro término."
                    : "Crea tu primer proyecto para organizar tareas."}
                </p>
                {!search && <ProjectFormDialog />}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filtered.map((project) => (
              <Card
                key={project.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/proyectos/${project.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground truncate">
                          {project.name}
                        </h3>
                        <Badge variant="outline" className={STATUS_STYLES[project.status]}>
                          {STATUS_LABELS[project.status]}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {(project as any).clients?.name ?? "Proyecto interno"}
                        {project.description && ` · ${project.description}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {project.area && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {SERVICE_LABELS[project.area]}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: project.id, name: project.name }); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
