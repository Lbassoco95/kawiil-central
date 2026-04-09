import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useProjectDetail } from "@/hooks/useProjects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator, CheckSquare, Scale, Building2, FileSpreadsheet, ClipboardList, Shield, Plus, PenTool, Loader2, MessageSquare, Sparkles, Trash2, AlertTriangle, CircleAlert } from "lucide-react";
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
import type { LucideIcon } from "lucide-react";

type ProjectStatus = Database["public"]["Enums"]["project_status"];

import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { PROJECT_STATUS_CONFIG } from "@/lib/statusStyles";
import { useProfiles, useDeleteTask, useUpdateTask } from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

import { PhaseManager, type Phase } from "@/components/projects/PhaseManager";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { TeamVisibilityBanner } from "@/components/shared/TeamVisibilityBanner";
import { useOpenTaskAssigneeUserIds } from "@/hooks/useOpenTaskAssigneeUserIds";

const STATUS_STYLES: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.color])
) as Record<ProjectStatus, string>;

const STATUS_LABELS: Record<ProjectStatus, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<ProjectStatus, string>;

const ProyectoDetalle = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const updateTask = useUpdateTask();
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

  const openTaskCount = useMemo(() => tasks.filter((t) => !isTaskClosedStatus(t.status)).length, [tasks]);
  const closedTaskCount = useMemo(() => tasks.filter((t) => isTaskClosedStatus(t.status)).length, [tasks]);
  const openProjectTasks = useMemo(() => tasks.filter((t) => !isTaskClosedStatus(t.status)), [tasks]);
  const openProjectTaskIds = useMemo(() => openProjectTasks.map((t) => t.id), [openProjectTasks]);
  const { data: projectTaskAssigneeIds = [], isLoading: loadingProjectTaskAssignees } =
    useOpenTaskAssigneeUserIds(openProjectTaskIds);

  const projectPhases: Phase[] = useMemo(() => {
    const raw = (project as any)?.phases;
    if (Array.isArray(raw) && raw.length > 0) return raw as Phase[];
    const lawsuit = (project as any)?.lawsuit_details;
    const stages = lawsuit?.stages;
    if (project?.area === "juicios" && Array.isArray(stages) && stages.length > 0) {
      return stages.map((s: { key: string; label?: string; name?: string }, i: number) => ({
        key: s.key,
        name: s.label ?? s.name ?? `Etapa ${i + 1}`,
        order: i,
      }));
    }
    const titlePhases = new Set<string>();
    for (const t of tasks) {
      const match = t.title?.match(/^\[([^\]]+)\]/);
      if (match) titlePhases.add(match[1]);
    }
    return Array.from(titlePhases).map((name, i) => ({ key: `legacy_${name.toLowerCase().replace(/\s+/g, "_")}`, name, order: i }));
  }, [project, tasks]);

  /** Desde /tareas: ubicar la fase de la tarea (URL phaseKey, phase_key, o prefijo [Nombre fase] en el título). */
  const expandPhaseKeyForDeepLink = useMemo(() => {
    const tid = searchParams.get("taskId");
    if (!tid || tasks.length === 0 || projectPhases.length === 0) return null;
    const urlPk = searchParams.get("phaseKey");
    if (urlPk) {
      if (urlPk === "__none__") return "__none__";
      if (projectPhases.some((p) => p.key === urlPk)) return urlPk;
    }
    const t = tasks.find((x) => x.id === tid);
    if (!t) return null;
    if (
      t.phase_key &&
      (t.phase_key === "__none__" || projectPhases.some((p) => p.key === t.phase_key))
    ) {
      return t.phase_key;
    }
    if (typeof t.title === "string") {
      const m = t.title.match(/^\[([^\]]+)\]\s*/);
      if (m) {
        const want = m[1].trim().toLowerCase();
        const ph = projectPhases.find((p) => (p.name || "").trim().toLowerCase() === want);
        if (ph) return ph.key;
      }
    }
    return "__none__";
  }, [searchParams, tasks, projectPhases]);

  const closeTaskDialog = useCallback(() => {
    setSelectedTaskId(null);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("taskId");
      p.delete("phaseKey");
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  const handlePhasesChange = useCallback(
    async (newPhases: Phase[]) => {
      const lawsuit = (project as any)?.lawsuit_details;
      const isLawsuitProject = project?.area === "juicios" && lawsuit && Array.isArray(lawsuit.stages);
      if (isLawsuitProject) {
        const byKey = new Map(lawsuit.stages.map((s: { key: string }) => [s.key, s]));
        const newStages = newPhases.map((p) => {
          const ex = byKey.get(p.key) as Record<string, unknown> | undefined;
          if (ex) return { ...ex, label: p.name };
          return {
            key: p.key,
            label: p.name,
            status: "pendiente",
            date: null,
            notes: "",
            completed_at: null,
            attachments: [],
            checklist: [],
          };
        });
        await supabase
          .from("projects")
          .update({
            phases: newPhases,
            lawsuit_details: { ...lawsuit, stages: newStages },
          } as any)
          .eq("id", id!);
      } else {
        await supabase.from("projects").update({ phases: newPhases } as any).eq("id", id!);
      }
      queryClient.invalidateQueries({ queryKey: ["project", id] });
    },
    [id, queryClient, project]
  );

  const [taskFormPhaseKey, setTaskFormPhaseKey] = useState<string | undefined>();
  const handleAddTaskForPhase = useCallback((phaseKey?: string) => {
    setTaskFormPhaseKey(phaseKey);
    setShowTaskForm(true);
  }, []);

  const handleTaskPhaseAssign = useCallback(
    async (taskId: string, phaseKey: string | null) => {
      try {
        await updateTask.mutateAsync({ id: taskId, phase_key: phaseKey });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo actualizar la fase de la tarea");
      }
    },
    [updateTask]
  );

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
  const profilesByUserId = useMemo(() => new Map(profiles.map((p) => [p.user_id, p])), [profiles]);

  const proyectoCollaboratorUserIds = useMemo(() => {
    if (!project) return [];
    const set = new Set<string>();
    for (const t of openProjectTasks) {
      if (t.assigned_to) set.add(t.assigned_to);
    }
    for (const uid of projectTaskAssigneeIds) set.add(uid);
    const pr = project.responsible_user_id;
    if (pr) set.delete(pr);
    const clientResp = (project as { clients?: { responsible_user_id?: string | null } | null }).clients
      ?.responsible_user_id;
    if (clientResp) set.delete(clientResp);
    return [...set].sort((a, b) => {
      const na = profilesByUserId.get(a)?.full_name || "";
      const nb = profilesByUserId.get(b)?.full_name || "";
      return na.localeCompare(nb, "es");
    });
  }, [project, openProjectTasks, projectTaskAssigneeIds, profilesByUserId]);

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

  const [tab, setTabState] = useState<string>(() => {
    if (initialTab) return initialTab;
    if (isCumplimiento) return "cumplimiento";
    if (isGestoria) return "gestoria";
    if (hasConstitution) return "constitucion";
    if (isLawsuit) return "juicio";
    if (hasAccounting) return "contabilidad";
    return "general";
  });

  const setTab = useCallback((newTab: string) => {
    setTabState(newTab);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", newTab);
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  // Handle deep-link to specific task or tab change from URL
  useEffect(() => {
    const taskId = searchParams.get("taskId");
    if (taskId) {
      setTabState("tareas");
      setSelectedTaskId(taskId);
    }
    const urlTab = searchParams.get("tab");
    if (urlTab && urlTab !== tab) {
      setTabState(urlTab);
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
  projectTabs.push({
    key: "tareas",
    label:
      closedTaskCount > 0
        ? `Tareas (${openTaskCount} · ${closedTaskCount} cerr.)`
        : `Tareas (${openTaskCount})`,
  });
  projectTabs.push({ key: "comentarios", label: "Comentarios", icon: MessageSquare });
  projectTabs.push({ key: "firmas", label: "Firmas", icon: PenTool });

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Hero header */}
        <div className="glass-card relative overflow-hidden p-5">
          <div className="absolute inset-0 opacity-[0.07] bg-gradient-to-br from-primary to-accent pointer-events-none" />
          <div className="relative flex items-start gap-3">
            <button onClick={() => navigate("/proyectos")} className="mt-0.5 p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-white/5 transition-colors">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight gradient-text truncate">{project.name}</h1>
                <Badge variant="outline" className={`text-[10px] border-0 px-1.5 py-0 ${STATUS_STYLES[project.status]}`}>
                  {STATUS_LABELS[project.status]}
                </Badge>
                {project.area && (
                  <span className="text-[10px] text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded-md">
                    {SERVICE_LABELS[project.area]}
                  </span>
                )}
                {(project as any).criticality_level === "critico" && (
                  <span title="Crítico" className="text-destructive"><AlertTriangle className="h-3.5 w-3.5" /></span>
                )}
                {(project as any).criticality_level === "atencion" && (
                  <span title="Atención" className="text-warning"><CircleAlert className="h-3.5 w-3.5" /></span>
                )}
                {(project as any).delay_category && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-warning/50 text-warning">Atraso</Badge>
                )}
              </div>
              {clientName && (
                <p className="text-sm text-muted-foreground mt-1">Cliente: {clientName}</p>
              )}
              {project.description && (
                <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{project.description}</p>
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
          <TeamVisibilityBanner
            responsibleHeading="Responsable del proyecto"
            responsibleUserId={project.responsible_user_id}
            secondaryHeading="Responsable del cliente"
            secondaryUserId={
              project.client_id
                ? (project as { clients?: { responsible_user_id?: string | null } | null }).clients
                    ?.responsible_user_id
                : undefined
            }
            profilesByUserId={profilesByUserId}
            collaboratorUserIds={proyectoCollaboratorUserIds}
            collaboratorsLoading={loadingProjectTaskAssignees && openProjectTaskIds.length > 0}
            collaboratorsEmptyHint="No hay otras personas en tareas abiertas de este proyecto ni como colaboradores adicionales en esas tareas (aparte del responsable del proyecto)."
            className="relative"
          />
        </div>

        {/* Tab pills */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1 flex-nowrap">
          {projectTabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`tab-pill inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${
                  tab === t.key ? "tab-pill-active" : "tab-pill-inactive"
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
          <AccountingDashboard
            projectId={project.id}
            clientDropboxPath={effectiveDropboxPath}
            clientId={project.client_id || undefined}
            projectArea={project.area || undefined}
          />
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
            <div className="flex justify-between items-center gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Tareas del proyecto</h3>
                <p className="text-[11px] text-muted-foreground/90 mt-0.5">
                  {openTaskCount} en curso
                  {closedTaskCount > 0 ? ` · ${closedTaskCount} completadas o canceladas (plegable por fase)` : ""}
                </p>
              </div>
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

            {tasks.length === 0 && projectPhases.length === 0 ? (
              <div className="text-center py-16">
                <CheckSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">Sin tareas en este proyecto.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowTaskForm(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Crear primera tarea
                </Button>
              </div>
            ) : (
              <PhaseManager
                phases={projectPhases}
                tasks={tasks}
                profileMap={profileMap}
                onPhasesChange={handlePhasesChange}
                onTaskClick={(taskId) => setSelectedTaskId(taskId)}
                onTaskPhaseAssign={handleTaskPhaseAssign}
                onAddTask={handleAddTaskForPhase}
                canDeleteTasks={canDeleteTasks}
                onDeleteTask={(taskId) => setDeleteTargetId(taskId)}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onToggleTaskSelection={toggleTaskSelection}
                expandPhaseKey={expandPhaseKeyForDeepLink}
              />
            )}

            {/* Bulk action bar */}
            {selectionMode && selectedTaskIds.size > 0 && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass-card rounded-full px-5 py-2.5 flex items-center gap-4 shadow-xl border-primary/15">
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
                if (!o) { setTaskFormPhaseKey(undefined); queryClient.invalidateQueries({ queryKey: ["project-tasks", id] }); }
              }}
              defaultProjectId={project.id}
              defaultClientId={project.client_id || undefined}
              defaultArea={project.area || undefined}
              defaultPhaseKey={taskFormPhaseKey}
            />
          </div>
        )}

        {tab === "comentarios" && (
          <ProjectCommentsTab projectId={project.id} projectName={project.name} />
        )}

        {tab === "firmas" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">Solicitudes de firma</h3>
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
      <TaskDetailDialog taskId={selectedTaskId} onClose={closeTaskDialog} />
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
