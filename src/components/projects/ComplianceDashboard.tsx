import { useState, useMemo } from "react";
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
  Calendar,
  Settings2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientComplianceConfig, useSaveClientCompliance } from "@/hooks/useCompliance";
import { ComplianceEntitySelector } from "@/components/compliance/ComplianceEntitySelector";
import { ComplianceTaskGeneratorModal } from "@/components/compliance/ComplianceTaskGeneratorModal";
import { ComplianceTaskRow } from "@/components/projects/ComplianceTaskRow";
import { formatMX, nowMX } from "@/lib/dateUtils";

const CATEGORY_LABELS: Record<string, string> = {
  reportes_uif: "Reportes al SAT/UIF",
  reportes_cnbv: "Reportes a CNBV",
  capacitacion: "Capacitación y cultura de cumplimiento",
  kyc: "Gestión de expedientes y KYC",
  politicas: "Políticas y manuales",
  auditoria: "Auditoría interna",
  avisos_sat: "Avisos al SAT (SAT-AV)",
  conservacion: "Conservación de información",
};

const PERIODICITY_LABELS: Record<string, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  cuando_aplique: "Cuando aplique",
};

interface ComplianceDashboardProps {
  projectId: string;
  clientId?: string | null;
  clientDropboxPath?: string;
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
  compliance_task_templates?: {
    category: string;
    due_description: string | null;
  } | null;
}

export function ComplianceDashboard({ projectId, clientId, clientDropboxPath }: ComplianceDashboardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const { data: complianceConfigs, isLoading: configLoading } = useClientComplianceConfig(clientId || undefined);
  const saveCompliance = useSaveClientCompliance();

  // Setup state (when no entity types configured yet)
  const [setupMode, setSetupMode] = useState(false);
  const [selectedEntityTypeIds, setSelectedEntityTypeIds] = useState<string[]>([]);
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [authorizationDate, setAuthorizationDate] = useState("");
  const [complianceOfficerName, setComplianceOfficerName] = useState("");

  // Task generator modal
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const hasComplianceConfig = (complianceConfigs || []).length > 0;
  const complianceEntityTypeIds = (complianceConfigs || []).map((c) => c.entity_type_id);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["compliance-tasks", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, compliance_task_templates(category, due_description)")
        .eq("project_id", projectId)
        .eq("area", "cumplimiento" as any)
        .order("due_date", { ascending: true }) as any;
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
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-[10px]">Completada</Badge>;
    }
    if (!task.due_date) {
      return <Badge variant="secondary" className="text-[10px]">Sin fecha</Badge>;
    }
    const daysUntil = Math.ceil((new Date(task.due_date).getTime() - today.getTime()) / 86400000);
    if (daysUntil < 0) {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">Vencida ({Math.abs(daysUntil)}d)</Badge>;
    }
    if (daysUntil <= 7) {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-[10px]">Urgente ({daysUntil}d)</Badge>;
    }
    if (daysUntil <= 30) {
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-[10px]">Próxima ({daysUntil}d)</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px]">Pendiente</Badge>;
  };

  // Group tasks by category
  const groupedTasks = useMemo(() => {
    const groups: Record<string, ComplianceTask[]> = {};
    for (const t of tasks) {
      const cat = (t.compliance_task_templates as any)?.category || "otros";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }
    return Object.entries(groups)
      .map(([key, tasks]) => ({
        key,
        label: CATEGORY_LABELS[key] || key,
        tasks,
        completed: tasks.filter((t) => t.status === "completada").length,
        total: tasks.length,
      }))
      .sort((a, b) => {
        const order = Object.keys(CATEGORY_LABELS);
        return order.indexOf(a.key) - order.indexOf(b.key);
      });
  }, [tasks]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "completada").length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const urgentTasks = tasks.filter((t) => {
    if (t.status === "completada" || !t.due_date) return false;
    const daysUntil = Math.ceil((new Date(t.due_date).getTime() - today.getTime()) / 86400000);
    return daysUntil <= 7;
  }).length;

  const entityTypeNames = (complianceConfigs || []).map((c) => c.entity_type?.name).filter(Boolean);

  const toggleCategory = (key: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

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
    // After saving, open the task generator
    setGeneratorOpen(true);
  };

  if (isLoading || configLoading) {
    return <Card><CardContent className="p-6 text-center text-muted-foreground">Cargando obligaciones...</CardContent></Card>;
  }

  // === SETUP MODE: No entity types configured ===
  if (!hasComplianceConfig && !setupMode && tasks.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <Shield className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <div>
              <h3 className="font-semibold text-foreground text-lg">Configurar Cumplimiento</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Para generar las obligaciones regulatorias, primero debes seleccionar el tipo de entidad regulada de este cliente.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                ¿Es un Transmisor de Dinero (CNBV)? ¿Una Actividad Vulnerable (LFPIORPI)? ¿Una IFPE? Selecciona los que apliquen.
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

  // === SETUP FORM: Selecting entity types ===
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
              Selecciona los tipos de entidad que aplican a este cliente. Se generarán automáticamente las obligaciones regulatorias correspondientes.
            </p>

            <div className="max-h-64 overflow-y-auto rounded-md border p-3">
              <ComplianceEntitySelector
                selectedIds={selectedEntityTypeIds}
                onChange={setSelectedEntityTypeIds}
              />
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
                <Input
                  type="date"
                  value={authorizationDate}
                  onChange={(e) => setAuthorizationDate(e.target.value)}
                />
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
                  Al continuar, se generarán todas las tareas obligatorias del año {new Date().getFullYear()} para las entidades seleccionadas.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSetupMode(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSaveConfig}
                disabled={selectedEntityTypeIds.length === 0 || saveCompliance.isPending}
              >
                {saveCompliance.isPending ? "Guardando..." : "Continuar y generar tareas"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // === HAS CONFIG BUT NO TASKS: Offer to generate ===
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
                  <Badge key={name} variant="outline" className="text-xs">{name}</Badge>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                Las obligaciones regulatorias aún no han sido generadas. Haz clic para crear todas las tareas del año {new Date().getFullYear()}.
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
          responsibleUserId={user!.id}
          onGenerated={() => {
            queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header summary */}
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
                    <Badge key={name} variant="outline" className="text-xs">{name}</Badge>
                  ))}
                </div>
              )}
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

      {/* Tasks grouped by category */}
      <div className="space-y-3">
        {groupedTasks.map((group) => {
          const isCollapsed = collapsedCategories.has(group.key);
          const groupPct = group.total > 0 ? Math.round((group.completed / group.total) * 100) : 0;

          return (
            <Collapsible key={group.key} open={!isCollapsed} onOpenChange={() => toggleCategory(group.key)}>
              <Card>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/30 transition-colors rounded-t-lg">
                  <div className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-semibold text-foreground">{group.label}</span>
                    <Badge variant="secondary" className="text-xs">
                      {group.completed}/{group.total}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={groupPct} className="h-1.5 w-20" />
                    <span className="text-xs text-muted-foreground w-8 text-right">{groupPct}%</span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-3 px-4">
                    <div className="space-y-2">
                      {group.tasks.map((task) => (
                        <ComplianceTaskRow
                          key={task.id}
                          task={task}
                          projectId={projectId}
                          urgencyBadge={getUrgencyBadge(task)}
                          onUpdate={refreshTasks}
                        />
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>

      {/* Generator modal for re-generation if needed */}
      <ComplianceTaskGeneratorModal
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        projectId={projectId}
        entityTypeIds={complianceEntityTypeIds}
        responsibleUserId={user!.id}
        onGenerated={() => {
          queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
        }}
      />
    </div>
  );
}
