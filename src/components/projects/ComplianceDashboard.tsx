import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Clock,
  AlertTriangle,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientComplianceConfig } from "@/hooks/useCompliance";
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

export function ComplianceDashboard({ projectId, clientId }: ComplianceDashboardProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const { data: complianceConfigs } = useClientComplianceConfig(clientId || undefined);

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

  const updateTask = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("tasks").update({ status } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance-tasks", projectId] });
    },
  });

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

  if (isLoading) {
    return <Card><CardContent className="p-6 text-center text-muted-foreground">Cargando obligaciones...</CardContent></Card>;
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
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <Shield className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              No hay tareas de cumplimiento generadas. Crea el proyecto desde el formulario para auto-generar las obligaciones.
            </p>
          </CardContent>
        </Card>
      ) : (
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
                      <div className="space-y-1">
                        {group.tasks.map((task) => (
                          <div
                            key={task.id}
                            className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                              task.status === "completada" ? "opacity-60" : "hover:bg-muted/50"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={task.status === "completada"}
                                onChange={() =>
                                  updateTask.mutate({
                                    id: task.id,
                                    status: task.status === "completada" ? "pendiente" : "completada",
                                  })
                                }
                                className="h-4 w-4 rounded border-muted-foreground/30 cursor-pointer"
                              />
                              <span className={`truncate ${task.status === "completada" ? "line-through" : ""}`}>
                                {task.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {task.compliance_periodicity && (
                                <Badge variant="outline" className="text-[10px]">
                                  {PERIODICITY_LABELS[task.compliance_periodicity] || task.compliance_periodicity}
                                </Badge>
                              )}
                              {task.compliance_period && (
                                <span className="text-[10px] text-muted-foreground">{task.compliance_period}</span>
                              )}
                              {task.due_date && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Calendar className="h-3 w-3" />
                                  {formatMX(task.due_date, "dd MMM")}
                                </span>
                              )}
                              {getUrgencyBadge(task)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
