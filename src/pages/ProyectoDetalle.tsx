import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useProjectDetail } from "@/hooks/useProjects";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator, FileText, CheckSquare } from "lucide-react";
import { AccountingDashboard } from "@/components/projects/AccountingDashboard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type ProjectStatus = Database["public"]["Enums"]["project_status"];
type ServiceArea = Database["public"]["Enums"]["service_area"];

const SERVICE_LABELS: Record<ServiceArea, string> = {
  contabilidad: "Contabilidad",
  legal: "Legal",
  softlanding: "Soft Landing",
  pld_ft: "PLD/FT",
  juicios: "Juicios",
};

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

const ProyectoDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProjectDetail(id);
  const { user } = useAuth();

  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("project_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!id,
  });

  // Determine if project has accounting service
  const hasAccounting = project?.area === "contabilidad" || project?.area === "softlanding";

  if (isLoading) {
    return (
      <AppLayout>
        <p className="text-center text-muted-foreground py-12">Cargando...</p>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Proyecto no encontrado</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/proyectos")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Volver
          </Button>
        </div>
      </AppLayout>
    );
  }

  const clientName = (project as any).clients?.name;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/proyectos")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground truncate">{project.name}</h1>
              <Badge variant="outline" className={STATUS_STYLES[project.status]}>
                {STATUS_LABELS[project.status]}
              </Badge>
              {project.area && (
                <Badge variant="secondary">{SERVICE_LABELS[project.area]}</Badge>
              )}
            </div>
            {clientName && (
              <p className="text-sm text-muted-foreground mt-1">
                Cliente: {clientName}
              </p>
            )}
            {project.description && (
              <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
            )}
          </div>
        </div>

        <Tabs defaultValue={hasAccounting ? "contabilidad" : "general"} className="space-y-4">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            {hasAccounting && (
              <TabsTrigger value="contabilidad">
                <Calculator className="h-4 w-4 mr-1" />
                Contabilidad
              </TabsTrigger>
            )}
            <TabsTrigger value="tareas">Tareas ({tasks.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Detalles del proyecto</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estado</span>
                    <Badge variant="outline" className={STATUS_STYLES[project.status]}>
                      {STATUS_LABELS[project.status]}
                    </Badge>
                  </div>
                  {project.area && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Área</span>
                      <span>{SERVICE_LABELS[project.area]}</span>
                    </div>
                  )}
                  {project.start_date && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inicio</span>
                      <span>{new Date(project.start_date).toLocaleDateString("es-MX")}</span>
                    </div>
                  )}
                  {project.end_date && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fin</span>
                      <span>{new Date(project.end_date).toLocaleDateString("es-MX")}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {hasAccounting && (
            <TabsContent value="contabilidad">
              <AccountingDashboard projectId={project.id} />
            </TabsContent>
          )}

          <TabsContent value="tareas">
            {tasks.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sin tareas en este proyecto.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {tasks.map((t) => (
                  <Card key={t.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-medium text-foreground truncate">{t.title}</h4>
                        <div className="flex gap-2 shrink-0">
                          <Badge variant="outline" className="text-xs">{t.priority}</Badge>
                          <Badge variant="secondary" className="text-xs">{t.status}</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default ProyectoDetalle;
