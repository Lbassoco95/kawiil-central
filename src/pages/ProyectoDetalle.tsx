import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useProjectDetail } from "@/hooks/useProjects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator, CheckSquare, Scale, Building2, FileSpreadsheet, ClipboardList, Shield, Plus, PenTool, Loader2, MessageSquare, Sparkles, User, Calendar, Trash2, Layers, ChevronDown, ChevronRight } from "lucide-react";
import { ProjectCommentsTab } from "@/components/projects/ProjectCommentsTab";
import { MeetingMinutesDialog } from "@/components/projects/MeetingMinutesDialog";
import { LawsuitDashboard } from "@/components/projects/LawsuitDashboard";
import { AccountingDashboard } from "@/components/projects/AccountingDashboard";
import { ConstitutionDashboard } from "@/components/projects/ConstitutionDashboard";
import { AnnualDeclarationDashboard } from "@/components/projects/AnnualDeclarationDashboard";
import { GestoriaDashboard } from "@/components/projects/GestoriaDashboard";
import { ComplianceDashboard } from "@/components/projects/ComplianceDashboard";
import { ProjectGeneralTab } from "@/components/projects/ProjectGeneralTab";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { formatDateMX } from "@/lib/dateUtils";
import type { LucideIcon } from "lucide-react";

type ProjectStatus = Database["public"]["Enums"]["project_status"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { PROJECT_STATUS_CONFIG, TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";
import { useProfiles, useDeleteTask } from "@/hooks/useTasks";
import { formatMX } from "@/lib/dateUtils";
import { useUserRole } from "@/hooks/useUserRole";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const STATUS_STYLES: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.color])
) as Record<ProjectStatus, string>;

const STATUS_LABELS: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<ProjectStatus, string>;

// Parse phase prefix from task title: "[Phase Name] Title" -> { phase: "Phase Name", cleanTitle: "Title" }
function parsePhase(title: string): { phase: string | null; cleanTitle: string } {
  const match = title.match(/^\[([^\]]+)\]\s*(.*)/);
  if (match) return { phase: match[1], cleanTitle: match[2] || title };
  return { phase: null, cleanTitle: title };
}

interface TaskRowProps {
  t: any;
  selectionMode: boolean;
  selectedTaskIds: Set<string>;
  toggleTaskSelection: (id: string) => void;
  setSelectedTaskId: (id: string) => void;
  profileMap: Map<string, string>;
  canDeleteTasks: boolean;
  setDeleteTargetId: (id: string) => void;
  showCleanTitle?: boolean;
}

function TaskRow({ t, selectionMode, selectedTaskIds, toggleTaskSelection, setSelectedTaskId, profileMap, canDeleteTasks, setDeleteTargetId, showCleanTitle }: TaskRowProps) {
  const { cleanTitle } = showCleanTitle ? parsePhase(t.title) : { cleanTitle: t.title };
  return (
    <div
      className={`flex items-center justify-between gap-4 py-3 px-2 -mx-2 rounded-lg hover:bg-secondary/30 transition-colors cursor-pointer ${selectedTaskIds.has(t.id) ? "bg-primary/5" : ""}`}
      onClick={() => selectionMode ? toggleTaskSelection(t.id) : setSelectedTaskId(t.id)}
    >
      {selectionMode && (
        <Checkbox
          checked={selectedTaskIds.has(t.id)}
          onCheckedChange={() => toggleTaskSelection(t.id)}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h4 className="text-[13px] font-medium text-foreground truncate">{cleanTitle}</h4>
          <Badge className={`text-[10px] border-0 px-1.5 py-0 ${PRIORITY_CONFIG[t.priority as keyof typeof PRIORITY_CONFIG]?.color || "bg-secondary/60 text-muted-foreground"}`} variant="secondary">
            {PRIORITY_CONFIG[t.priority as keyof typeof PRIORITY_CONFIG]?.label || t.priority}
          </Badge>
          <Badge className={`text-[10px] border-0 px-1.5 py-0 ${TASK_STATUS_CONFIG[t.status as keyof typeof TASK_STATUS_CONFIG]?.color || "bg-secondary/60 text-muted-foreground"}`} variant="secondary">
            {TASK_STATUS_CONFIG[t.status as keyof typeof TASK_STATUS_CONFIG]?.label || t.status}
          </Badge>
          {t.criticality_level === "critico" && <span className="text-[10px]" title="Crítico">🔴</span>}
          {t.criticality_level === "atencion" && <span className="text-[10px]" title="Atención">🟡</span>}
          {t.delay_category && <Badge variant="outline" className="text-[9px] px-1 py-0 border-warning/50 text-warning">⚠ Atraso</Badge>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {t.assigned_to && profileMap.get(t.assigned_to) ? (
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{profileMap.get(t.assigned_to)}</span>
          ) : (
            <span className="flex items-center gap-1 text-destructive/70 font-medium">⚠ Sin responsable</span>
          )}
          {t.due_date && (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatMX(t.due_date, "dd MMM yyyy")}</span>
          )}
        </div>
      </div>
      {canDeleteTasks && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => { e.stopPropagation(); setDeleteTargetId(t.id); }}
          title="Eliminar tarea"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

interface TaskListGroupedProps {
  tasks: any[];
  selectionMode: boolean;
  selectedTaskIds: Set<string>;
  toggleTaskSelection: (id: string) => void;
  setSelectedTaskId: (id: string) => void;
  profileMap: Map<string, string>;
  canDeleteTasks: boolean;
  setDeleteTargetId: (id: string) => void;
}

function TaskListGrouped({ tasks, selectionMode, selectedTaskIds, toggleTaskSelection, setSelectedTaskId, profileMap, canDeleteTasks, setDeleteTargetId }: TaskListGroupedProps) {
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());

  const { groups, hasPhases } = useMemo(() => {
    const map = new Map<string, any[]>();
    tasks.forEach(t => {
      const { phase } = parsePhase(t.title);
      const key = phase || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    const hasPhases = [...map.keys()].some(k => k !== "__none__");
    const ordered = [...map.entries()].sort(([a], [b]) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return 0;
    });
    return { groups: ordered, hasPhases };
  }, [tasks]);

  const toggleCollapse = (phase: string) => {
    setCollapsedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      return next;
    });
  };

  if (!hasPhases) {
    return (
      <div className="divide-y divide-border/40">
        {tasks.map(t => (
          <TaskRow key={t.id} t={t} selectionMode={selectionMode} selectedTaskIds={selectedTaskIds} toggleTaskSelection={toggleTaskSelection} setSelectedTaskId={setSelectedTaskId} profileMap={profileMap} canDeleteTasks={canDeleteTasks} setDeleteTargetId={setDeleteTargetId} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(([phaseKey, phaseTasks]) => {
        const phaseName = phaseKey === "__none__" ? "Sin fase" : phaseKey;
        const isCollapsed = collapsedPhases.has(phaseKey);
        const completedCount = phaseTasks.filter((t: any) => t.status === "completada").length;
        return (
          <div key={phaseKey} className="rounded-lg border border-border/50 overflow-hidden">
            <button
              onClick={() => toggleCollapse(phaseKey)}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-secondary/40 hover:bg-secondary/60 transition-colors text-left"
            >
              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-semibold text-foreground flex-1">{phaseName}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {completedCount}/{phaseTasks.length}
              </Badge>
            </button>
            {!isCollapsed && (
              <div className="divide-y divide-border/40 px-2">
                {phaseTasks.map((t: any) => (
                  <TaskRow key={t.id} t={t} selectionMode={selectionMode} selectedTaskIds={selectedTaskIds} toggleTaskSelection={toggleTaskSelection} setSelectedTaskId={setSelectedTaskId} profileMap={profileMap} canDeleteTasks={canDeleteTasks} setDeleteTargetId={setDeleteTargetId} showCleanTitle />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ProyectoDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProjectDetail(id);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [signRequests, setSignRequests] = useState<any[]>([]);
  const [loadingSign, setLoadingSign] = useState(false);
  const [showMinutesDialog, setShowMinutesDialog] = useState(false);
  const { canDeleteTasks } = useUserRole();
  const deleteTask = useDeleteTask();
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedTaskIds(prev => prev.size === tasks.length ? new Set() : new Set(tasks.map(t => t.id)));
  }, [tasks]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedTaskIds(new Set());
  }, []);

  const { data: profiles = [] } = useProfiles();
  const profileMap = useMemo(() => new Map(profiles.map(p => [p.user_id, p.full_name])), [profiles]);

  const hasAccounting = project?.area === "contabilidad" || project?.area === "softlanding";
  const isSoftlanding = project?.area === "softlanding";
  const isConstitutionNacional = project?.area === "constitucion_nacional";
  const hasConstitution = isSoftlanding || isConstitutionNacional;
  const isGestoria = project?.area === "gestoria";
  const isLawsuit = project?.area === "juicios" && (project as any)?.lawsuit_details;
  const isCumplimiento = project?.area === "cumplimiento";
  const lawsuitDetails = (project as any)?.lawsuit_details;
  const constitutionDetails = (project as any)?.constitution_details ?? null;

  const initialTab = searchParams.get("tab");

  const [tab, setTab] = useState<string>(() => {
    if (initialTab) return initialTab;
    if (isCumplimiento) return "cumplimiento";
    if (isGestoria) return "gestoria";
    if (hasConstitution) return "constitucion";
    if (isLawsuit) return "juicio";
    if (hasAccounting) return "contabilidad";
    return "general";
  });

  // Handle deep-link to specific task
  useEffect(() => {
    const taskId = searchParams.get("taskId");
    if (taskId) {
      setTab("tareas");
      setSelectedTaskId(taskId);
    }
  }, [searchParams]);

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
  // For lawsuit projects, default to /Kawiil Mx/JUICIOS folder
  const effectiveDropboxPath = isLawsuit
    ? (clientDropboxPath?.trim() || "/Kawiil Mx/JUICIOS")
    : (clientDropboxPath?.trim() || fallbackDropboxPath);
  const lockDropboxToInitialPath = Boolean(clientDropboxPath?.trim());

  // Build dynamic tabs
  const projectTabs: { key: string; label: string; icon?: LucideIcon }[] = [
    { key: "general", label: "General" },
  ];
  if (hasConstitution) projectTabs.push({ key: "constitucion", label: "Constitución", icon: Building2 });
  if (isGestoria) projectTabs.push({ key: "gestoria", label: "Gestoría", icon: ClipboardList });
  if (hasAccounting) projectTabs.push({ key: "contabilidad", label: "Contabilidad", icon: Calculator });
  if (hasAccounting) projectTabs.push({ key: "declaracion_anual", label: "Declaración Anual", icon: FileSpreadsheet });
  if (isLawsuit) projectTabs.push({ key: "juicio", label: "Juicio", icon: Scale });
  if (isCumplimiento) projectTabs.push({ key: "cumplimiento", label: "Cumplimiento", icon: Shield });
  projectTabs.push({ key: "tareas", label: `Tareas (${tasks.length})` });
  projectTabs.push({ key: "comentarios", label: "Comentarios", icon: MessageSquare });
  projectTabs.push({ key: "firmas", label: "Firmas", icon: PenTool });

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
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setShowMinutesDialog(true)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Subir minuta</span>
          </Button>
        </div>

        {/* Tab pills */}
        <div className="flex flex-wrap gap-1.5">
          {projectTabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  tab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {tab === "general" && <ProjectGeneralTab project={project} />}

        {tab === "constitucion" && hasConstitution && (
          <ConstitutionDashboard
            projectId={project.id}
            constitutionDetails={constitutionDetails}
            responsibleUserId={project.responsible_user_id}
            clientDropboxPath={effectiveDropboxPath}
            clientId={project.client_id || undefined}
          />
        )}

        {tab === "gestoria" && isGestoria && (
          <GestoriaDashboard
            projectId={project.id}
            gestoriaDetails={constitutionDetails}
            responsibleUserId={project.responsible_user_id}
            clientDropboxPath={effectiveDropboxPath}
            clientId={project.client_id || undefined}
          />
        )}

        {tab === "contabilidad" && hasAccounting && (
          <AccountingDashboard projectId={project.id} clientDropboxPath={effectiveDropboxPath} clientId={project.client_id || undefined} />
        )}

        {tab === "declaracion_anual" && hasAccounting && (
          <AnnualDeclarationDashboard projectId={project.id} clientDropboxPath={effectiveDropboxPath} clientId={project.client_id || undefined} />
        )}

        {tab === "juicio" && isLawsuit && (
          <LawsuitDashboard
            projectId={project.id}
            lawsuitDetails={lawsuitDetails}
            dropboxInitialPath={effectiveDropboxPath}
            lockDropboxToInitialPath={lockDropboxToInitialPath}
            clientId={project.client_id || undefined}
          />
        )}

        {tab === "cumplimiento" && isCumplimiento && (
          <ComplianceDashboard projectId={project.id} clientId={project.client_id} clientDropboxPath={effectiveDropboxPath} projectResponsibleUserId={project.responsible_user_id} />
        )}

        {tab === "tareas" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Tareas del proyecto</h3>
              <div className="flex items-center gap-2">
                {canDeleteTasks && tasks.length > 0 && (
                  <Button
                    size="sm"
                    variant={selectionMode ? "secondary" : "outline"}
                    onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1" />
                    {selectionMode ? "Cancelar" : "Seleccionar"}
                  </Button>
                )}
                <Button size="sm" onClick={() => setShowTaskForm(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Crear tarea
                </Button>
              </div>
            </div>

            {selectionMode && tasks.length > 0 && (
              <div className="flex items-center gap-2 px-2">
                <Checkbox
                  checked={selectedTaskIds.size === tasks.length && tasks.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-xs text-muted-foreground">Seleccionar todas</span>
              </div>
            )}

            {tasks.length === 0 ? (
              <div className="text-center py-16">
                <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">Sin tareas en este proyecto.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowTaskForm(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Crear primera tarea
                </Button>
              </div>
            ) : (
              <TaskListGrouped
                tasks={tasks}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                toggleTaskSelection={toggleTaskSelection}
                setSelectedTaskId={setSelectedTaskId}
                profileMap={profileMap}
                canDeleteTasks={canDeleteTasks}
                setDeleteTargetId={setDeleteTargetId}
              />
            )}

            {/* Bulk action bar */}
            {selectionMode && selectedTaskIds.size > 0 && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-background border border-border shadow-lg rounded-full px-5 py-2.5 flex items-center gap-4">
                <span className="text-sm font-medium">{selectedTaskIds.size} tarea{selectedTaskIds.size > 1 ? "s" : ""} seleccionada{selectedTaskIds.size > 1 ? "s" : ""}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowBulkDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Eliminar
                </Button>
              </div>
            )}

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
          </div>
        )}

        {tab === "comentarios" && (
          <ProjectCommentsTab projectId={project.id} projectName={project.name} />
        )}

        {tab === "firmas" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Solicitudes de firma</h3>
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
                {loadingSign ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Cargar firmas"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Envía archivos a firma desde el ícono ✒️ junto a archivos Dropbox en cada paso.
            </p>

            {signRequests.length > 0 ? (
              <div className="divide-y divide-border/40">
                {signRequests.map((sr: any) => (
                  <div key={sr.signature_request_id} className="flex items-center gap-3 py-3">
                    <PenTool className={`h-4 w-4 shrink-0 ${sr.is_complete ? "text-success" : sr.is_declined ? "text-destructive" : "text-primary"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">{sr.title}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {sr.signatures?.map((sig: any, i: number) => (
                          <span key={i} className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                            {sig.signer_name}: {sig.status === "signed" ? "Firmado" : sig.status === "declined" ? "Rechazado" : "Pendiente"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded shrink-0">
                      {sr.is_complete ? "Completada" : sr.is_declined ? "Rechazada" : "Pendiente"}
                    </span>
                  </div>
                ))}
              </div>
            ) : !loadingSign ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Haz clic en "Cargar firmas" para ver las solicitudes.
              </p>
            ) : null}
          </div>
        )}
      </div>
      <TaskDetailDialog taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      <DeleteConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={(o) => { if (!o) setDeleteTargetId(null); }}
        title="¿Eliminar esta tarea?"
        description="Se eliminará permanentemente esta tarea y todos sus datos asociados."
        onConfirm={async () => {
          try {
            await deleteTask.mutateAsync(deleteTargetId!);
            toast.success("Tarea eliminada");
            setDeleteTargetId(null);
            queryClient.invalidateQueries({ queryKey: ["project-tasks", id] });
          } catch (e: any) {
            toast.error("Error al eliminar: " + e.message);
          }
        }}
        isPending={deleteTask.isPending}
      />
      <DeleteConfirmDialog
        open={showBulkDelete}
        onOpenChange={(o) => { if (!o) setShowBulkDelete(false); }}
        title={`¿Eliminar ${selectedTaskIds.size} tarea${selectedTaskIds.size > 1 ? "s" : ""}?`}
        description={`Se eliminarán permanentemente ${selectedTaskIds.size} tarea${selectedTaskIds.size > 1 ? "s" : ""} y todos sus datos asociados.`}
        onConfirm={async () => {
          setBulkDeleting(true);
          try {
            for (const taskId of selectedTaskIds) {
              await deleteTask.mutateAsync(taskId);
            }
            toast.success(`${selectedTaskIds.size} tarea${selectedTaskIds.size > 1 ? "s" : ""} eliminada${selectedTaskIds.size > 1 ? "s" : ""}`);
            exitSelectionMode();
            setShowBulkDelete(false);
            queryClient.invalidateQueries({ queryKey: ["project-tasks", id] });
          } catch (e: any) {
            toast.error("Error al eliminar: " + e.message);
          } finally {
            setBulkDeleting(false);
          }
        }}
        isPending={bulkDeleting}
      />
      <MeetingMinutesDialog
        open={showMinutesDialog}
        onOpenChange={setShowMinutesDialog}
        projectId={project.id}
        clientId={project.client_id}
        area={project.area}
        projectName={project.name}
      />
    </AppLayout>
  );
};

export default ProyectoDetalle;
