import { useState, useMemo, useEffect, useCallback, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Shield,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Settings2,
  Plus,
  Layers,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientComplianceConfig, useSaveClientCompliance, type ClientComplianceConfig } from "@/hooks/useCompliance";
import { ComplianceEntitySelector } from "@/components/compliance/ComplianceEntitySelector";
import { ComplianceTaskGeneratorModal } from "@/components/compliance/ComplianceTaskGeneratorModal";
import { ComplianceTaskRow } from "@/components/projects/ComplianceTaskRow";
import { nowMX } from "@/lib/dateUtils";
import { CriticalityDelayCard } from "./CriticalityDelayCard";
import { isTaskOpenStatus, isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { cn } from "@/lib/utils";
import { projectPhaseColorClass } from "./projectPhaseVisual";
import { ensureCompliancePhasesOnProject, type SyncPhase } from "@/lib/projectPhaseSync";
import { complianceCategoryLabel } from "@/lib/compliancePhaseCatalog";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { formatComplianceRegDate } from "@/lib/complianceProjectSummary";
import { ensureComplianceProjectForClient } from "@/lib/ensureComplianceProject";

function ComplianceRegulatorySummary({
  configs,
  className,
}: {
  configs: ClientComplianceConfig[];
  className?: string;
}) {
  if (!configs.length) return null;
  const ref = configs[0];
  if (
    !ref.registration_number?.trim() &&
    !ref.authorization_date &&
    !ref.compliance_officer_name?.trim()
  ) {
    return null;
  }
  return (
    <div
      className={cn(
        "mt-3 rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground space-y-1 max-w-md mx-auto",
        className,
      )}
    >
      {ref.registration_number?.trim() ? (
        <p>
          <span className="font-medium text-foreground/80">Folio / registro:</span>{" "}
          {ref.registration_number.trim()}
        </p>
      ) : null}
      {ref.authorization_date ? (
        <p>
          <span className="font-medium text-foreground/80">Autorización / inicio:</span>{" "}
          {formatComplianceRegDate(ref.authorization_date)}
        </p>
      ) : null}
      {ref.compliance_officer_name?.trim() ? (
        <p>
          <span className="font-medium text-foreground/80">Responsable en el cliente:</span>{" "}
          {ref.compliance_officer_name.trim()}
        </p>
      ) : null}
    </div>
  );
}

function sortComplianceTasksForList(a: ComplianceTask, b: ComplianceTask) {
  const rank = (s: string) => {
    if (isTaskOpenStatus(s)) return 0;
    if (s === "completada") return 1;
    if (s === "cancelada") return 2;
    return 0;
  };
  const d = rank(a.status) - rank(b.status);
  if (d !== 0) return d;
  const ad = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
  const bd = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
  return ad - bd;
}

function resolveComplianceBucket(task: ComplianceTask): string {
  const pk = task.phase_key?.trim();
  if (pk) return pk;
  const cat = (task.compliance_task_templates as { category?: string } | null)?.category;
  if (cat) return cat;
  return "otros";
}

interface ComplianceDashboardProps {
  projectId: string;
  clientId?: string | null;
  clientDropboxPath?: string;
  projectResponsibleUserId?: string | null;
}

interface ComplianceTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  compliance_periodicity: string | null;
  compliance_period: string | null;
  compliance_template_id: string | null;
  assigned_to: string | null;
  phase_key?: string | null;
  compliance_task_templates?: {
    category: string;
    due_description: string | null;
  } | null;
}

function ComplianceClosedTasksCollapsible({
  tasks,
  projectId,
  clientDropboxPath,
  clientId,
  getUrgencyBadge,
  onUpdate,
}: {
  tasks: ComplianceTask[];
  projectId: string;
  clientDropboxPath?: string;
  clientId?: string | null;
  getUrgencyBadge: (task: ComplianceTask) => ReactNode;
  onUpdate: () => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <Collapsible defaultOpen={false} className="group mt-1 border-t border-border/30 pt-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
        Completadas o canceladas ({tasks.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1 pb-1">
        {tasks.map((task, idx) => (
          <ComplianceTaskRow
            key={task.id}
            task={task}
            projectId={projectId}
            clientDropboxPath={clientDropboxPath}
            clientId={clientId ?? undefined}
            urgencyBadge={getUrgencyBadge(task)}
            onUpdate={onUpdate}
            index={idx}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CompliancePhaseCard({
  phase,
  phaseIndex,
  persistedOrderIndex,
  persistedOrderCount,
  tasksOpen,
  tasksClosed,
  projectId,
  clientDropboxPath,
  clientId,
  getUrgencyBadge,
  onUpdate,
  onAddTask,
  onMovePhase,
  persistedInProject,
}: {
  phase: SyncPhase;
  phaseIndex: number;
  /** Índice en `projects.phases` ordenadas (solo para flechas subir/bajar). */
  persistedOrderIndex: number;
  persistedOrderCount: number;
  tasksOpen: ComplianceTask[];
  tasksClosed: ComplianceTask[];
  projectId: string;
  clientDropboxPath?: string;
  clientId?: string | null;
  getUrgencyBadge: (task: ComplianceTask) => ReactNode;
  onUpdate: () => void;
  onAddTask: (phaseKey: string) => void;
  onMovePhase: (phaseKey: string, direction: "up" | "down") => void;
  persistedInProject: boolean;
}) {
  const [open, setOpen] = useState(true);
  const total = tasksOpen.length + tasksClosed.length;
  const completed = tasksOpen.concat(tasksClosed).filter((t) => t.status === "completada").length;
  const groupPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const shellClass = cn("rounded-xl border overflow-hidden", projectPhaseColorClass(phaseIndex));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={shellClass}>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5">
        <CollapsibleTrigger asChild>
          <button type="button" className="shrink-0 rounded-sm hover:bg-muted/50 p-0.5">
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>
        <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
        <Layers className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0 hidden sm:block" />
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{phase.name}</span>
        {persistedInProject && persistedOrderIndex >= 0 && (
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={persistedOrderIndex <= 0}
              title="Subir fase"
              onClick={(e) => {
                e.stopPropagation();
                onMovePhase(phase.key, "up");
              }}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={persistedOrderIndex >= persistedOrderCount - 1}
              title="Bajar fase"
              onClick={(e) => {
                e.stopPropagation();
                onMovePhase(phase.key, "down");
              }}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <div className="hidden sm:flex items-center gap-1.5 w-20 shrink-0">
          <Progress value={groupPct} className="h-1.5" />
          <span className="text-[10px] text-muted-foreground w-7 text-right">{groupPct}%</span>
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
          {completed}/{total}
        </Badge>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onAddTask(phase.key);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="px-2 pb-3 space-y-3 border-t border-border/30 bg-background/30">
          <div className="space-y-2 pt-2">
            {total === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 px-2 rounded-lg bg-muted/20">
                Sin tareas en esta fase. Usa «Agregar tarea» para crear obligaciones adicionales (también aparecen en el tab
                Tareas).
              </p>
            ) : (
              <div className="space-y-2">
                {tasksOpen.length === 0 && tasksClosed.length > 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2 px-2">
                    No hay tareas en curso en esta fase.
                  </p>
                )}
                {tasksOpen.map((task, idx) => (
                  <ComplianceTaskRow
                    key={task.id}
                    task={task}
                    projectId={projectId}
                    clientDropboxPath={clientDropboxPath}
                    clientId={clientId ?? undefined}
                    urgencyBadge={getUrgencyBadge(task)}
                    onUpdate={onUpdate}
                    index={idx}
                  />
                ))}
                <ComplianceClosedTasksCollapsible
                  tasks={tasksClosed}
                  projectId={projectId}
                  clientDropboxPath={clientDropboxPath}
                  clientId={clientId}
                  getUrgencyBadge={getUrgencyBadge}
                  onUpdate={onUpdate}
                />
              </div>
            )}
            <Button
              variant="default"
              size="sm"
              className="w-full text-xs font-medium shadow-sm"
              onClick={() => onAddTask(phase.key)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Agregar tarea
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ComplianceDashboard({
  projectId,
  clientId,
  clientDropboxPath,
  projectResponsibleUserId,
}: ComplianceDashboardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: complianceConfigs, isLoading: configLoading } = useClientComplianceConfig(clientId || undefined);
  const saveCompliance = useSaveClientCompliance();

  const [setupMode, setSetupMode] = useState(false);
  const [selectedEntityTypeIds, setSelectedEntityTypeIds] = useState<string[]>([]);
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [authorizationDate, setAuthorizationDate] = useState("");
  const [complianceOfficerName, setComplianceOfficerName] = useState("");

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskFormPhaseKey, setTaskFormPhaseKey] = useState<string | undefined>();

  const hasComplianceConfig = (complianceConfigs || []).length > 0;
  const complianceEntityTypeIds = (complianceConfigs || []).map((c) => c.entity_type_id);

  const complianceSyncEntityKey = useMemo(
    () =>
      (complianceConfigs || [])
        .map((c) => c.entity_type_id)
        .filter(Boolean)
        .sort()
        .join(","),
    [complianceConfigs],
  );

  const { data: projectRow } = useQuery({
    queryKey: ["compliance-dashboard-project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, phases").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });

  useEffect(() => {
    if (!user || !projectId) return;
    let cancelled = false;
    ensureCompliancePhasesOnProject(projectId)
      .then((changed) => {
        if (!cancelled && changed) {
          queryClient.invalidateQueries({ queryKey: ["project", projectId] });
          queryClient.invalidateQueries({ queryKey: ["compliance-dashboard-project", projectId] });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, projectId, queryClient]);

  /** Al abrir el tab: poda de tareas anteriores a la apertura del proyecto + alta de faltantes (idempotente). Sin guardar de nuevo la config. */
  useEffect(() => {
    if (!user?.id || !clientId || !projectId || configLoading) return;
    if (!complianceSyncEntityKey) return;
    const entityTypeIds = complianceSyncEntityKey.split(",").filter(Boolean);
    if (entityTypeIds.length === 0) return;
    let cancelled = false;
    ensureComplianceProjectForClient({
      clientId,
      userId: user.id,
      entityTypeIds,
    })
      .then(() => {
        if (cancelled) return;
        queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id, clientId, projectId, configLoading, complianceSyncEntityKey, queryClient]);

  const projectPhases: SyncPhase[] = useMemo(() => {
    const raw = projectRow?.phases;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw as SyncPhase[];
  }, [projectRow?.phases]);

  const phaseKeySet = useMemo(() => new Set(projectPhases.map((p) => p.key)), [projectPhases]);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["compliance-tasks", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, compliance_task_templates(category, due_description)")
        .eq("project_id", projectId)
        .eq("area", "cumplimiento" as any)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data || []) as ComplianceTask[];
    },
    enabled: !!user && !!projectId,
  });

  const refreshTasks = () => {
    queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
  };

  const today = useMemo(() => nowMX(), []);

  const getUrgencyBadge = (task: ComplianceTask) => {
    if (task.status === "completada") {
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-[10px]">Completada</Badge>
      );
    }
    if (!task.due_date) {
      return (
        <Badge variant="secondary" className="text-[10px]">
          Sin fecha
        </Badge>
      );
    }
    const daysUntil = Math.ceil((new Date(task.due_date).getTime() - today.getTime()) / 86400000);
    if (daysUntil < 0) {
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">
          Vencida ({Math.abs(daysUntil)}d)
        </Badge>
      );
    }
    if (daysUntil <= 7) {
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">
          Urgente ({daysUntil}d)
        </Badge>
      );
    }
    if (daysUntil <= 30) {
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-[10px]">
          Próxima ({daysUntil}d)
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-[10px]">
        Pendiente
      </Badge>
    );
  };

  const tasksByBucket = useMemo(() => {
    const map = new Map<string, ComplianceTask[]>();
    for (const t of tasks) {
      const b = resolveComplianceBucket(t);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(t);
    }
    for (const [, list] of map) {
      list.sort(sortComplianceTasksForList);
    }
    return map;
  }, [tasks]);

  const sortedProjectPhases = useMemo(
    () => [...projectPhases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [projectPhases]
  );

  const orderedPhases = useMemo(() => {
    const base = sortedProjectPhases;
    const keys = new Set(base.map((p) => p.key));
    const extras: SyncPhase[] = [];
    for (const b of tasksByBucket.keys()) {
      if (!keys.has(b)) {
        extras.push({
          key: b,
          name: complianceCategoryLabel(b),
          order: 9999 + extras.length,
        });
      }
    }
    extras.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return [...base, ...extras];
  }, [sortedProjectPhases, tasksByBucket]);

  const openAddTask = useCallback((phaseKey: string) => {
    setTaskFormPhaseKey(phaseKey);
    setShowTaskForm(true);
  }, []);

  const handleMovePhase = useCallback(
    async (phaseKey: string, direction: "up" | "down") => {
      if (!phaseKeySet.has(phaseKey)) return;
      const sorted = [...projectPhases].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const idx = sorted.findIndex((p) => p.key === phaseKey);
      const j = direction === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || j < 0 || j >= sorted.length) return;
      const a = { ...sorted[idx] };
      const b = { ...sorted[j] };
      const temp = a.order;
      a.order = b.order;
      b.order = temp;
      const next = sorted.map((p) => (p.key === a.key ? a : p.key === b.key ? b : p));
      const { error } = await supabase.from("projects").update({ phases: next } as any).eq("id", projectId);
      if (error) return;
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["compliance-dashboard-project", projectId] });
    },
    [projectPhases, phaseKeySet, projectId, queryClient]
  );

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "completada").length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const urgentTasks = tasks.filter((t) => {
    if (t.status === "completada" || t.status === "cancelada" || !t.due_date) return false;
    const daysUntil = Math.ceil((new Date(t.due_date).getTime() - today.getTime()) / 86400000);
    return daysUntil <= 7;
  }).length;

  const entityTypeNames = (complianceConfigs || []).map((c) => c.entity_type?.name).filter(Boolean);

  const handleSaveConfig = async () => {
    if (!clientId) return;
    await saveCompliance.mutateAsync({
      clientId,
      entityTypeIds: selectedEntityTypeIds,
      registrationNumber,
      authorizationDate,
      complianceOfficerName,
    });
    setSetupMode(false);
    setGeneratorOpen(true);
  };

  if (isLoading || configLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">Cargando obligaciones...</CardContent>
      </Card>
    );
  }

  if (!hasComplianceConfig && !setupMode && tasks.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <Shield className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <div>
              <h3 className="font-semibold text-foreground text-lg">Configurar Cumplimiento</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Para generar las obligaciones regulatorias, primero debes seleccionar el tipo de entidad regulada de este
                cliente.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                ¿Es un Transmisor de Dinero (CNBV)? ¿Una Actividad Vulnerable (LFPIORPI)? ¿Una IFPE? Selecciona los que
                apliquen.
              </p>
            </div>
            <Button onClick={() => setSetupMode(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Configurar tipo de entidad
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (setupMode) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground">Seleccionar tipo de entidad regulada</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Selecciona los tipos de entidad que aplican a este cliente. Se generarán automáticamente las obligaciones
              regulatorias correspondientes.
            </p>

            <div className="max-h-64 overflow-y-auto rounded-md border p-3">
              <ComplianceEntitySelector selectedIds={selectedEntityTypeIds} onChange={setSelectedEntityTypeIds} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Número de registro / Folio regulatorio</Label>
                <Input
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder="Folio o número de registro (opcional)"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Fecha de autorización</Label>
                <Input type="date" value={authorizationDate} onChange={(e) => setAuthorizationDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Responsable de cumplimiento en el cliente</Label>
              <Input
                value={complianceOfficerName}
                onChange={(e) => setComplianceOfficerName(e.target.value)}
                placeholder="Nombre del oficial de cumplimiento del cliente (opcional)"
              />
            </div>

            {selectedEntityTypeIds.length > 0 && (
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <p className="font-medium text-foreground mb-1">Entidades seleccionadas:</p>
                <p className="text-muted-foreground">
                  Al continuar, se generarán todas las tareas obligatorias del año {new Date().getFullYear()} para las
                  entidades seleccionadas.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSetupMode(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveConfig} disabled={selectedEntityTypeIds.length === 0 || saveCompliance.isPending}>
                {saveCompliance.isPending ? "Guardando..." : "Continuar y generar tareas"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (hasComplianceConfig && tasks.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <Shield className="mx-auto h-12 w-12 text-primary/50" />
            <div>
              <h3 className="font-semibold text-foreground text-lg">Entidad configurada</h3>
              <div className="flex flex-wrap justify-center gap-1 mt-2">
                {entityTypeNames.map((name) => (
                  <Badge key={name} variant="outline" className="text-xs">
                    {name}
                  </Badge>
                ))}
              </div>
              <ComplianceRegulatorySummary configs={complianceConfigs || []} />
              <p className="text-sm text-muted-foreground mt-3">
                Las obligaciones regulatorias aún no han sido generadas. Haz clic para crear todas las tareas del año{" "}
                {new Date().getFullYear()}.
              </p>
            </div>
            <Button onClick={() => setGeneratorOpen(true)}>
              <Shield className="mr-2 h-4 w-4" />
              Generar tareas de cumplimiento
            </Button>
          </CardContent>
        </Card>

        <ComplianceTaskGeneratorModal
          open={generatorOpen}
          onOpenChange={setGeneratorOpen}
          projectId={projectId}
          entityTypeIds={complianceEntityTypeIds}
          responsibleUserId={projectResponsibleUserId || user!.id}
          clientId={clientId}
          onGenerated={() => {
            queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CriticalityDelayCard projectId={projectId} />
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">Panel de Cumplimiento</h3>
              </div>
              {entityTypeNames.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {entityTypeNames.map((name) => (
                    <Badge key={name} variant="outline" className="text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              <ComplianceRegulatorySummary
                configs={complianceConfigs || []}
                className="mx-0 max-w-none mb-3"
              />
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  {completedTasks}/{totalTasks} completadas
                </span>
                {urgentTasks > 0 && (
                  <span className="flex items-center gap-1 text-destructive font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {urgentTasks} urgente{urgentTasks !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-foreground">{progressPct}%</span>
              <Progress value={progressPct} className="h-2 w-32 mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {orderedPhases.map((phase, listIndex) => {
          const bucketTasks = tasksByBucket.get(phase.key) || [];
          const tasksOpen = bucketTasks.filter((t) => !isTaskClosedStatus(t.status));
          const tasksClosed = bucketTasks.filter((t) => isTaskClosedStatus(t.status));
          const persistedInProject = phaseKeySet.has(phase.key);
          const persistedOrderIndex = persistedInProject
            ? sortedProjectPhases.findIndex((p) => p.key === phase.key)
            : -1;
          const phaseIndex = persistedOrderIndex >= 0 ? persistedOrderIndex : listIndex;

          return (
            <CompliancePhaseCard
              key={phase.key}
              phase={phase}
              phaseIndex={phaseIndex}
              persistedOrderIndex={persistedOrderIndex}
              persistedOrderCount={sortedProjectPhases.length}
              tasksOpen={tasksOpen}
              tasksClosed={tasksClosed}
              projectId={projectId}
              clientDropboxPath={clientDropboxPath}
              clientId={clientId}
              getUrgencyBadge={getUrgencyBadge}
              onUpdate={refreshTasks}
              onAddTask={openAddTask}
              onMovePhase={handleMovePhase}
              persistedInProject={persistedInProject}
            />
          );
        })}
      </div>

      <ComplianceTaskGeneratorModal
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        projectId={projectId}
        entityTypeIds={complianceEntityTypeIds}
        responsibleUserId={projectResponsibleUserId || user!.id}
        clientId={clientId}
        onGenerated={() => {
          queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
        }}
      />

      <TaskFormDialog
        open={showTaskForm}
        onOpenChange={(o) => {
          setShowTaskForm(o);
          if (!o) {
            setTaskFormPhaseKey(undefined);
            queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
            queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
          }
        }}
        defaultProjectId={projectId}
        defaultClientId={clientId || undefined}
        defaultArea="cumplimiento"
        defaultPhaseKey={taskFormPhaseKey}
      />
    </div>
  );
}
