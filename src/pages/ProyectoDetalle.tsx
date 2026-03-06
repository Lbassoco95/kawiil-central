import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useProjectDetail } from "@/hooks/useProjects";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator, CheckSquare, Scale, Building2, FileSpreadsheet } from "lucide-react";
import { LawsuitDashboard } from "@/components/projects/LawsuitDashboard";
import { AccountingDashboard } from "@/components/projects/AccountingDashboard";
import { ConstitutionDashboard } from "@/components/projects/ConstitutionDashboard";
import { AnnualDeclarationDashboard } from "@/components/projects/AnnualDeclarationDashboard";
import { ProjectGeneralTab } from "@/components/projects/ProjectGeneralTab";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { formatDateMX } from "@/lib/dateUtils";

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
  const isSoftlanding = project?.area === "softlanding";
  const isLawsuit = project?.area === "juicios" && (project as any)?.lawsuit_details;
  const lawsuitDetails = (project as any)?.lawsuit_details;
  const constitutionDetails = (project as any)?.constitution_details ?? null;

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
  const clientDropboxPath = (project as any).clients?.dropbox_folder_path as string | null | undefined;
  const normalizedClientName = clientName?.trim();
  const fallbackDropboxPath = normalizedClientName
    ? `/Kawiil Mx/CLIENTES/${normalizedClientName}`
    : "/Kawiil Mx/CLIENTES";
  const effectiveDropboxPath = clientDropboxPath?.trim() || fallbackDropboxPath;
  const lockDropboxToInitialPath = Boolean(clientDropboxPath?.trim());

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

        <Tabs defaultValue={isSoftlanding ? "constitucion" : isLawsuit ? "juicio" : hasAccounting ? "contabilidad" : "general"} className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="general">General</TabsTrigger>
            {isSoftlanding && (
              <TabsTrigger value="constitucion">
                <Building2 className="h-4 w-4 mr-1" />
                Constitución
              </TabsTrigger>
            )}
            {hasAccounting && (
              <TabsTrigger value="contabilidad">
                <Calculator className="h-4 w-4 mr-1" />
                Contabilidad
              </TabsTrigger>
            )}
            {hasAccounting && (
              <TabsTrigger value="declaracion_anual">
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Declaración Anual
              </TabsTrigger>
            )}
            {isLawsuit && (
              <TabsTrigger value="juicio">
                <Scale className="h-4 w-4 mr-1" />
                Juicio
              </TabsTrigger>
            )}
            <TabsTrigger value="tareas">Tareas ({tasks.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <ProjectGeneralTab project={project} />
          </TabsContent>

          {isSoftlanding && (
            <TabsContent value="constitucion">
              <ConstitutionDashboard
                projectId={project.id}
                constitutionDetails={constitutionDetails}
              />
            </TabsContent>
          )}

          {hasAccounting && (
            <TabsContent value="contabilidad">
              <AccountingDashboard projectId={project.id} />
            </TabsContent>
          )}

          {hasAccounting && (
            <TabsContent value="declaracion_anual">
              <AnnualDeclarationDashboard projectId={project.id} />
            </TabsContent>
          )}

          {isLawsuit && (
            <TabsContent value="juicio">
              <LawsuitDashboard
                projectId={project.id}
                lawsuitDetails={lawsuitDetails}
                dropboxInitialPath={effectiveDropboxPath}
                lockDropboxToInitialPath={lockDropboxToInitialPath}
              />
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
