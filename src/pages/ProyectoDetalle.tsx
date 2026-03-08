import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useProjectDetail } from "@/hooks/useProjects";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator, CheckSquare, Scale, Building2, FileSpreadsheet, ClipboardList, Shield, Plus, PenTool, Loader2, MessageSquare } from "lucide-react";
import { ProjectCommentsTab } from "@/components/projects/ProjectCommentsTab";
import { LawsuitDashboard } from "@/components/projects/LawsuitDashboard";
import { AccountingDashboard } from "@/components/projects/AccountingDashboard";
import { ConstitutionDashboard } from "@/components/projects/ConstitutionDashboard";
import { AnnualDeclarationDashboard } from "@/components/projects/AnnualDeclarationDashboard";
import { GestoriaDashboard } from "@/components/projects/GestoriaDashboard";
import { ComplianceDashboard } from "@/components/projects/ComplianceDashboard";
import { ProjectGeneralTab } from "@/components/projects/ProjectGeneralTab";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { formatDateMX } from "@/lib/dateUtils";

type ProjectStatus = Database["public"]["Enums"]["project_status"];
type ServiceArea = Database["public"]["Enums"]["service_area"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";

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

const ProyectoDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProjectDetail(id);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [signRequests, setSignRequests] = useState<any[]>([]);
  const [loadingSign, setLoadingSign] = useState(false);

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
  const isConstitutionNacional = project?.area === "constitucion_nacional";
  const hasConstitution = isSoftlanding || isConstitutionNacional;
  const isGestoria = project?.area === "gestoria";
  const isLawsuit = project?.area === "juicios" && (project as any)?.lawsuit_details;
  const isCumplimiento = project?.area === "cumplimiento";
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
        <div className="flex items-start gap-3">
          <button onClick={() => navigate("/proyectos")} className="mt-1 p-1 rounded-lg hover:bg-secondary/60 transition-colors">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground truncate">{project.name}</h1>
              <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 ${STATUS_STYLES[project.status]}`}>
                {STATUS_LABELS[project.status]}
              </Badge>
              {project.area && (
                <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                  {SERVICE_LABELS[project.area]}
                </span>
              )}
              {(project as any).criticality_level === "critico" && <span title="Crítico">🔴</span>}
              {(project as any).criticality_level === "atencion" && <span title="Atención">🟡</span>}
              {(project as any).delay_category && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-warning/50 text-warning">⚠ Atraso</Badge>
              )}
            </div>
            {clientName && (
              <p className="text-sm text-muted-foreground mt-0.5">Cliente: {clientName}</p>
            )}
            {project.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{project.description}</p>
            )}
          </div>
        </div>

        <Tabs defaultValue={isCumplimiento ? "cumplimiento" : isGestoria ? "gestoria" : hasConstitution ? "constitucion" : isLawsuit ? "juicio" : hasAccounting ? "contabilidad" : "general"} className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="general">General</TabsTrigger>
            {hasConstitution && (
              <TabsTrigger value="constitucion">
                <Building2 className="h-4 w-4 mr-1" />
                Constitución
              </TabsTrigger>
            )}
            {isGestoria && (
              <TabsTrigger value="gestoria">
                <ClipboardList className="h-4 w-4 mr-1" />
                Gestoría
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
            {isCumplimiento && (
              <TabsTrigger value="cumplimiento">
                <Shield className="h-4 w-4 mr-1" />
                Cumplimiento
              </TabsTrigger>
            )}
            <TabsTrigger value="tareas">Tareas ({tasks.length})</TabsTrigger>
            <TabsTrigger value="comentarios">
              <MessageSquare className="h-4 w-4 mr-1" />
              Comentarios
            </TabsTrigger>
            <TabsTrigger value="firmas">
              <PenTool className="h-4 w-4 mr-1" />
              Firmas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <ProjectGeneralTab project={project} />
          </TabsContent>

          {hasConstitution && (
            <TabsContent value="constitucion">
              <ConstitutionDashboard
                projectId={project.id}
                constitutionDetails={constitutionDetails}
                responsibleUserId={project.responsible_user_id}
                clientDropboxPath={effectiveDropboxPath}
              />
            </TabsContent>
          )}

          {isGestoria && (
            <TabsContent value="gestoria">
              <GestoriaDashboard
                projectId={project.id}
                gestoriaDetails={constitutionDetails}
                responsibleUserId={project.responsible_user_id}
                clientDropboxPath={effectiveDropboxPath}
              />
            </TabsContent>
          )}

          {hasAccounting && (
            <TabsContent value="contabilidad">
              <AccountingDashboard projectId={project.id} clientDropboxPath={effectiveDropboxPath} />
            </TabsContent>
          )}

          {hasAccounting && (
            <TabsContent value="declaracion_anual">
              <AnnualDeclarationDashboard projectId={project.id} clientDropboxPath={effectiveDropboxPath} />
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

          {isCumplimiento && (
            <TabsContent value="cumplimiento">
              <ComplianceDashboard projectId={project.id} clientId={project.client_id} clientDropboxPath={effectiveDropboxPath} />
            </TabsContent>
          )}

          <TabsContent value="tareas">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-foreground">Tareas del proyecto</h3>
                <Button size="sm" onClick={() => setShowTaskForm(true)}>
                  <Plus className="h-4 w-4 mr-1" />Crear tarea
                </Button>
              </div>

              {tasks.length === 0 ? (
                <div className="text-center py-16">
                  <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">Sin tareas en este proyecto.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowTaskForm(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Crear primera tarea
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 py-3 px-1">
                      <h4 className="text-[13px] font-medium text-foreground truncate">{t.title}</h4>
                      <div className="flex gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">{t.priority}</span>
                        <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">{t.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <TaskFormDialog
              open={showTaskForm}
              onOpenChange={(o) => {
                setShowTaskForm(o);
                if (!o) queryClient.invalidateQueries({ queryKey: ["project-tasks", id] });
              }}
              defaultProjectId={project.id}
              defaultClientId={project.client_id || undefined}
              defaultArea={project.area || undefined}
            />
          </TabsContent>

          {/* Dropbox Sign tab */}
          <TabsContent value="firmas">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PenTool className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-foreground">Solicitudes de firma</h3>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingSign}
                    onClick={async () => {
                      setLoadingSign(true);
                      try {
                        const { data, error } = await supabase.functions.invoke("dropbox-sign", {
                          body: { action: "list", page: 1, page_size: 50 },
                        });
                        if (error) throw error;
                        setSignRequests(data.requests || []);
                      } catch {
                        setSignRequests([]);
                      } finally {
                        setLoadingSign(false);
                      }
                    }}
                  >
                    {loadingSign ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cargar firmas"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Las solicitudes de firma se envían desde los archivos de cada paso. Haz clic en el ícono ✒️ junto a un archivo de Dropbox para enviarlo a firma.
                </p>

                {signRequests.length > 0 ? (
                  <div className="space-y-2">
                    {signRequests.map((sr: any) => (
                      <div key={sr.signature_request_id} className="flex items-center gap-3 p-3 rounded-md border text-sm">
                        <PenTool className={`h-4 w-4 shrink-0 ${sr.is_complete ? "text-green-600" : sr.is_declined ? "text-destructive" : "text-primary"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{sr.title}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {sr.signatures?.map((sig: any, i: number) => (
                              <Badge
                                key={i}
                                variant={sig.status === "signed" ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {sig.signer_name}: {sig.status === "signed" ? "Firmado" : sig.status === "declined" ? "Rechazado" : "Pendiente"}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Badge variant={sr.is_complete ? "default" : "outline"} className="text-xs shrink-0">
                          {sr.is_complete ? "Completada" : sr.is_declined ? "Rechazada" : "Pendiente"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : !loadingSign ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Haz clic en "Cargar firmas" para ver las solicitudes de Dropbox Sign.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default ProyectoDetalle;
