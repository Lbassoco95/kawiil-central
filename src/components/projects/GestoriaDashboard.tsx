import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Save, ClipboardList, CalendarClock, Plus, ChevronRight,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { UnifiedStepRow } from "./UnifiedStepRow";
import { CriticalityDelayCard } from "./CriticalityDelayCard";
import { ProjectPhaseStageCard } from "./ProjectPhaseStageCard";
import { PhaseTaskRow } from "./PhaseManager";
import { useProfiles, useDeleteTask } from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { gestoriaPhaseKey, ensureGestoriaPhasesOnProject } from "@/lib/projectPhaseSync";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GESTORIA_TRAMITE_TYPES,
  getGestoriaPhases,
  getGestoriaDefaultSteps,
  getGestoriaTramiteLabel,
} from "@/lib/gestoriaTramiteCatalog";

import type { AccountingStep } from "@/hooks/useAccountingPeriods";

interface GestoriaStep extends AccountingStep {
  description: string;
  icon: string;
  phase: number;
  status: "pendiente" | "en_progreso" | "completado";
  appointment_date?: string | null;
}

interface Props {
  projectId: string;
  gestoriaDetails: { steps: GestoriaStep[]; tramite_type?: string | null } | null;
  responsibleUserId?: string | null;
  clientDropboxPath?: string;
  clientId?: string;
}

export function GestoriaDashboard({ projectId, gestoriaDetails, responsibleUserId, clientDropboxPath, clientId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { canDeleteTasks } = useUserRole();
  const deleteTask = useDeleteTask();
  const { data: profiles = [] } = useProfiles();
  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.user_id, p.full_name])), [profiles]);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskFormPhaseKey, setTaskFormPhaseKey] = useState<string | undefined>();

  const { data: projectTasks = [] } = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId && !!gestoriaDetails,
  });

  useEffect(() => {
    if (!gestoriaDetails || !projectId) return;
    let cancelled = false;
    ensureGestoriaPhasesOnProject(projectId, gestoriaDetails.tramite_type ?? null)
      .then((changed) => {
        if (!cancelled && changed) queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gestoriaDetails, projectId, queryClient]);

  const openAddTaskForPhase = useCallback((phaseNumber: number) => {
    setTaskFormPhaseKey(gestoriaPhaseKey(phaseNumber));
    setShowTaskForm(true);
  }, []);

  // Local source of truth — useState so UI re-renders from it
  const [localGestoria, setLocalGestoria] = useState(gestoriaDetails);

  // Sync from props only when no mutation is in flight
  useEffect(() => {
    if (!saveMutation.isPending) {
      setLocalGestoria(gestoriaDetails);
    }
  }, [gestoriaDetails]);

  const [selectedTramite, setSelectedTramite] = useState("");

  const tramiteType = localGestoria?.tramite_type ?? null;
  const phases = getGestoriaPhases(tramiteType);

  const steps: GestoriaStep[] = (localGestoria?.steps ?? []).map((s) => ({
    ...s,
    completed: s.status === "completado",
    completed_by: s.completed_by ?? null,
    step_status: s.step_status || (s.status === "en_progreso" ? "en_progreso" : s.status === "completado" ? "completado" : "pendiente"),
  }));

  const completedCount = steps.filter((s) => s.status === "completado").length;
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: async (payload: { steps: GestoriaStep[]; tramite_type: string | null }) => {
      setLocalGestoria(payload);
      const { error } = await supabase
        .from("projects")
        .update({ constitution_details: payload } as any)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      toast.success("Progreso guardado");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });

  const updateStep = (key: string, updates: Partial<GestoriaStep>) => {
    const currentSteps = localGestoria?.steps ?? steps;
    const updated = currentSteps.map((s) => {
      if (s.key !== key) return s;
      const merged = { ...s, ...updates };
      const newStepStatus = updates.step_status || s.step_status;
      let newStatus: GestoriaStep["status"] = s.status;
      if (newStepStatus === "completado") newStatus = "completado";
      else if (newStepStatus === "en_progreso" || newStepStatus === "en_espera_cliente") newStatus = "en_progreso";
      else if (newStepStatus === "pendiente") newStatus = "pendiente";
      return {
        ...merged,
        status: newStatus,
        completed_at: newStatus === "completado" ? new Date().toISOString() : newStatus !== s.status ? null : s.completed_at,
      };
    });
    saveMutation.mutate({ steps: updated, tramite_type: tramiteType });
  };

  const startTramite = (type: string) => {
    if (!type) return;
    const seeded = getGestoriaDefaultSteps(type).map((s) => ({
      ...s,
      assigned_to: responsibleUserId || null,
    })) as GestoriaStep[];
    saveMutation.mutate({ steps: seeded, tramite_type: type });
  };

  // Sin pasos aún → selector de tipo de trámite.
  if (!gestoriaDetails || !(gestoriaDetails.steps?.length)) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <div>
            <h3 className="font-semibold text-foreground">Módulo de Gestoría</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Elige el tipo de trámite para generar su flujo de fases y pasos.
            </p>
          </div>
          <div className="max-w-xs mx-auto space-y-3">
            <Select value={selectedTramite} onValueChange={setSelectedTramite}>
              <SelectTrigger><SelectValue placeholder="Seleccionar trámite" /></SelectTrigger>
              <SelectContent>
                {GESTORIA_TRAMITE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={!selectedTramite || saveMutation.isPending}
              onClick={() => startTramite(selectedTramite)}
            >
              <ClipboardList className="mr-2 h-4 w-4" /> Iniciar trámite
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CriticalityDelayCard projectId={projectId} />
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-foreground">Progreso de gestoría</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{getGestoriaTramiteLabel(tramiteType)}</p>
            </div>
            <span className="text-sm font-medium text-muted-foreground">{completedCount}/{steps.length} pasos</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </CardContent>
      </Card>

      <h3 className="text-sm font-medium text-muted-foreground">Fases del trámite</h3>
      {phases.map((phase) => {
        const phaseSteps = steps.filter((s) => s.phase === phase.number);
        if (phaseSteps.length === 0) return null;
        const completedInPhase = phaseSteps.filter((s) => s.status === "completado").length;
        const totalInPhase = phaseSteps.length;
        const phasePct = totalInPhase ? Math.round((completedInPhase / totalInPhase) * 100) : 0;

        return (
          <ProjectPhaseStageCard
            key={phase.number}
            colorIndex={phase.number - 1}
            title={`Fase ${phase.number}: ${phase.label}`}
            progressPercent={phasePct}
            completedCount={completedInPhase}
            totalCount={totalInPhase}
            defaultOpen
          >
            {phaseSteps.map((step) => {
              const globalIdx = steps.findIndex((s) => s.key === step.key);
              const hasAppointment = step.appointment_date !== undefined;

              return (
                <UnifiedStepRow
                  key={step.key}
                  step={step}
                  index={globalIdx}
                  projectId={projectId}
                  clientDropboxPath={clientDropboxPath}
                  clientId={clientId}
                  showTimer={false}
                  showCheckbox={false}
                  onSave={(updates) => updateStep(step.key, updates as Partial<GestoriaStep>)}
                  saving={saveMutation.isPending}
                  rootClassName="border-border/50 shadow-sm"
                  allowScan
                  extraFields={hasAppointment ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" /> Fecha y hora de cita
                      </label>
                      <div className="flex gap-2 items-center">
                        <Input
                          type="datetime-local"
                          className="text-sm h-8 w-auto"
                          defaultValue={step.appointment_date || ""}
                          id={`gestoria-appointment-${step.key}`}
                        />
                        <Button size="sm" variant="outline" className="h-8" disabled={saveMutation.isPending}
                          onClick={() => {
                            const el = document.getElementById(`gestoria-appointment-${step.key}`) as HTMLInputElement;
                            if (el) updateStep(step.key, { appointment_date: el.value || null });
                          }}>
                          <Save className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : undefined}
                />
              );
            })}
            {(() => {
              const pk = gestoriaPhaseKey(phase.number);
              const phaseTasks = projectTasks.filter((t: { phase_key?: string | null }) => t.phase_key === pk);
              const openT = phaseTasks.filter((t: { status: string }) => !isTaskClosedStatus(t.status));
              const closedT = phaseTasks.filter((t: { status: string }) => isTaskClosedStatus(t.status));
              return (
                <div className="border-t border-border/40 pt-3 mt-3 space-y-2">
                  <p className="text-[10px] font-medium text-muted-foreground px-1">Tareas del proyecto (esta fase)</p>
                  {phaseTasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2 px-1">
                      Sin tareas. Crea una para seguimiento adicional; también aparecen en el tab Tareas.
                    </p>
                  ) : (
                    <div className="space-y-0.5">
                      {openT.map((t: { id: string }) => (
                        <PhaseTaskRow
                          key={t.id}
                          task={t}
                          profileMap={profileMap}
                          onClick={() => setSelectedTaskId(t.id)}
                          canDelete={canDeleteTasks}
                          onDelete={() => setDeleteTargetId(t.id)}
                          showCleanTitle
                        />
                      ))}
                      {closedT.length > 0 && (
                        <Collapsible defaultOpen={false} className="group mt-1 border-t border-border/30 pt-1">
                          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40">
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                            Completadas o canceladas ({closedT.length})
                          </CollapsibleTrigger>
                          <CollapsibleContent className="space-y-0.5 pt-1 pb-1">
                            {closedT.map((t: { id: string }) => (
                              <PhaseTaskRow
                                key={t.id}
                                task={t}
                                profileMap={profileMap}
                                archived
                                onClick={() => setSelectedTaskId(t.id)}
                                canDelete={canDeleteTasks}
                                onDelete={() => setDeleteTargetId(t.id)}
                                showCleanTitle
                              />
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                  )}
                  <Button variant="default" size="sm" className="w-full text-xs font-medium shadow-sm" onClick={() => openAddTaskForPhase(phase.number)}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Agregar tarea
                  </Button>
                </div>
              );
            })()}
          </ProjectPhaseStageCard>
        );
      })}

      <TaskDetailDialog taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      <TaskFormDialog
        open={showTaskForm}
        onOpenChange={(o) => {
          setShowTaskForm(o);
          if (!o) {
            setTaskFormPhaseKey(undefined);
            queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
          }
        }}
        defaultProjectId={projectId}
        defaultClientId={clientId}
        defaultArea="gestoria"
        defaultPhaseKey={taskFormPhaseKey}
      />
      <DeleteConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={(o) => {
          if (!o) setDeleteTargetId(null);
        }}
        title="¿Eliminar esta tarea?"
        description="Se eliminará permanentemente esta tarea y todos sus datos asociados."
        onConfirm={async () => {
          try {
            await deleteTask.mutateAsync(deleteTargetId!);
            toast.success("Tarea eliminada");
            setDeleteTargetId(null);
            queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
          } catch (e: unknown) {
            toast.error("Error al eliminar: " + (e instanceof Error ? e.message : String(e)));
          }
        }}
        isPending={deleteTask.isPending}
      />
    </div>
  );
}
