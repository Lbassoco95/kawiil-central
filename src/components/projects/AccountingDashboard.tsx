import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Plus,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Layers,
  ShieldAlert,
  FileBadge,
  FileCheck2,
  Download,
  Loader2,
} from "lucide-react";
import { nowMX } from "@/lib/dateUtils";
import {
  useAccountingPeriods,
  useCreateAccountingPeriod,
  getMonthName,
  type AccountingPeriod,
} from "@/hooks/useAccountingPeriods";
import { cn } from "@/lib/utils";
import { StepDetailRow } from "./StepDetailRow";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { CriticalityDelayCard } from "./CriticalityDelayCard";
import { projectPhaseColorClass } from "./projectPhaseVisual";
import { accountingPeriodPhaseKey, ensureAccountingPeriodPhasesOnProject } from "@/lib/projectPhaseSync";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfiles, useDeleteTask } from "@/hooks/useTasks";
import { useUserRole } from "@/hooks/useUserRole";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { PhaseTaskRow } from "./PhaseManager";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { toast } from "sonner";

type MoffinConsultType = "lista_69b" | "constancia_situacion_fiscal" | "opinion_cumplimiento";

const MOFFIN_CONSULT_META: Record<
  MoffinConsultType,
  { label: string; short: string; icon: typeof ShieldAlert; apiNote: string }
> = {
  lista_69b: {
    label: "Lista 69-B (SAT)",
    short: "69-B",
    icon: ShieldAlert,
    apiNote: "POST /query/sat_blacklist",
  },
  constancia_situacion_fiscal: {
    label: "Constancia de situación fiscal",
    short: "Constancia",
    icon: FileBadge,
    apiNote: "POST /query/sat_rfc (certificados)",
  },
  opinion_cumplimiento: {
    label: "Opinión de cumplimiento",
    short: "Opinión",
    icon: FileCheck2,
    apiNote: "POST /query/sat_rfc (certificados)",
  },
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  pendiente: { label: "Pendiente", icon: Clock, className: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En progreso", icon: AlertCircle, className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  completado: { label: "Completado", icon: CheckCircle2, className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
};

function buildPeriodPrompt(period: AccountingPeriod) {
  const completed = period.steps.filter((s) => s.completed);
  const pending = period.steps.filter((s) => !s.completed);
  const inProgress = period.steps.filter((s) => s.step_status === "en_progreso");
  const waiting = period.steps.filter((s) => s.step_status === "en_espera_cliente");

  return `Eres Kawiil, asistente inteligente de un despacho contable en México. Genera un reporte ejecutivo breve (máx 150 palabras) del periodo contable ${getMonthName(period.month)} ${period.year}.

Estado general: ${period.status}
Pasos completados (${completed.length}/${period.steps.length}):
${completed.map((s) => `- ✅ ${s.label}${s.completed_at ? ` (${new Date(s.completed_at).toLocaleDateString("es-MX")})` : ""}${s.time_spent_seconds ? ` [${Math.round(s.time_spent_seconds / 60)} min]` : ""}${s.notes ? ` — ${s.notes}` : ""}`).join("\n") || "Ninguno"}

En progreso (${inProgress.length}):
${inProgress.map((s) => `- 🔄 ${s.label}${s.notes ? ` — ${s.notes}` : ""}`).join("\n") || "Ninguno"}

En espera del cliente (${waiting.length}):
${waiting.map((s) => `- ⏳ ${s.label}${s.notes ? ` — ${s.notes}` : ""}`).join("\n") || "Ninguno"}

Pendientes (${pending.length}):
${pending.map((s) => `- ⬜ ${s.label}`).join("\n") || "Ninguno"}

Incluye: resumen de avance, tiempos invertidos si hay datos, alertas de pasos atrasados o bloqueados, y recomendaciones. Usa Markdown con bullets.`;
}

function buildGeneralPrompt(periods: AccountingPeriod[]) {
  const summary = periods.map((p) => {
    const done = p.steps.filter((s) => s.completed).length;
    const total = p.steps.length;
    const totalTime = p.steps.reduce((acc, s) => acc + (s.time_spent_seconds || 0), 0);
    const blocked = p.steps.filter((s) => s.step_status === "en_espera_cliente").length;
    return `- ${getMonthName(p.month)} ${p.year}: ${p.status} (${done}/${total} pasos)${totalTime ? ` [${Math.round(totalTime / 60)} min totales]` : ""}${blocked ? ` ⚠️ ${blocked} en espera del cliente` : ""}`;
  }).join("\n");

  return `Eres Kawiil, asistente inteligente de un despacho contable en México. Genera un reporte ejecutivo general (máx 200 palabras) del proyecto contable completo.

Periodos registrados (${periods.length}):
${summary}

Analiza: tendencia de avance entre periodos, tiempos promedio de cierre, periodos con más bloqueos, eficiencia general. Da recomendaciones estratégicas para mejorar el flujo contable. Usa Markdown.`;
}

function PeriodCard({
  period,
  projectId,
  colorIndex,
  clientDropboxPath,
  clientId,
  periodTasks,
  profileMap,
  onOpenAddTask,
  onTaskClick,
  canDeleteTasks,
  onDeleteTask,
}: {
  period: AccountingPeriod;
  projectId: string;
  colorIndex: number;
  clientDropboxPath?: string;
  clientId?: string;
  periodTasks: any[];
  profileMap: Map<string, string>;
  onOpenAddTask: (periodId: string) => void;
  onTaskClick: (taskId: string) => void;
  canDeleteTasks?: boolean;
  onDeleteTask?: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(period.status !== "completado");
  const stepCompleted = period.steps.filter((s) => s.completed).length;
  const stepTotal = period.steps.length;
  const stepPct = stepTotal > 0 ? Math.round((stepCompleted / stepTotal) * 100) : 0;
  const openTasks = periodTasks.filter((t) => !isTaskClosedStatus(t.status));
  const closedTasks = periodTasks.filter((t) => isTaskClosedStatus(t.status));
  const taskProgress = periodTasks.length
    ? Math.round((periodTasks.filter((t) => t.status === "completada").length / periodTasks.length) * 100)
    : 0;
  const config = STATUS_CONFIG[period.status] || STATUS_CONFIG.pendiente;
  const StatusIcon = config.icon;

  const periodPrompt = useMemo(() => buildPeriodPrompt(period), [period]);
  const shellClass = cn("rounded-xl border overflow-hidden", projectPhaseColorClass(colorIndex));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={shellClass}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <CollapsibleTrigger asChild>
          <button type="button" className="shrink-0 rounded-sm hover:bg-muted/50 p-0.5">
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
        <Layers className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0 hidden sm:block" />
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">
          {getMonthName(period.month)} {period.year}
        </span>
        <Badge variant="outline" className={cn("text-[10px] shrink-0 hidden sm:inline-flex", config.className)}>
          <StatusIcon className="h-3 w-3 mr-1" />
          {config.label}
        </Badge>
        <div className="hidden sm:flex items-center gap-1.5 w-20 shrink-0">
          <Progress value={stepPct} className="h-1.5" />
          <span className="text-[10px] text-muted-foreground w-7 text-right">{stepPct}%</span>
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
          {stepCompleted}/{stepTotal} pasos
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
          {periodTasks.filter((t) => t.status === "completada").length}/{periodTasks.length} tareas
        </Badge>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onOpenAddTask(period.id);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="px-2 pb-3 space-y-3 border-t border-border/30 bg-background/30">
          <div className="space-y-2 pt-2">
            <p className="text-[10px] font-medium text-muted-foreground px-1">Pasos del periodo</p>
            {period.steps.map((step, idx) => (
              <StepDetailRow
                key={step.key}
                step={step}
                index={idx}
                periodId={period.id}
                projectId={projectId}
                clientDropboxPath={clientDropboxPath}
                clientId={clientId}
              />
            ))}
          </div>

          <div className="space-y-2 border-t border-border/30 pt-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="text-[10px] font-medium text-muted-foreground">Tareas del proyecto (este periodo)</p>
              {periodTasks.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{taskProgress}%</span>
              )}
            </div>
            {periodTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 px-2 rounded-lg bg-muted/20">
                Sin tareas vinculadas. Usa «Agregar tarea» para crear trabajos asociados a {getMonthName(period.month)} {period.year} (también aparecen en el tab Tareas).
              </p>
            ) : (
              <div className="space-y-0.5">
                {openTasks.map((t) => (
                  <PhaseTaskRow
                    key={t.id}
                    task={t}
                    profileMap={profileMap}
                    onClick={() => onTaskClick(t.id)}
                    canDelete={canDeleteTasks}
                    onDelete={() => onDeleteTask?.(t.id)}
                    showCleanTitle
                  />
                ))}
                {closedTasks.length > 0 && (
                  <Collapsible defaultOpen={false} className="group mt-1 border-t border-border/30 pt-1">
                    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                      Completadas o canceladas ({closedTasks.length})
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-0.5 pt-1 pb-1">
                      {closedTasks.map((t) => (
                        <PhaseTaskRow
                          key={t.id}
                          task={t}
                          profileMap={profileMap}
                          archived
                          onClick={() => onTaskClick(t.id)}
                          canDelete={canDeleteTasks}
                          onDelete={() => onDeleteTask?.(t.id)}
                          showCleanTitle
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
            <Button variant="default" size="sm" className="w-full text-xs font-medium shadow-sm" onClick={() => onOpenAddTask(period.id)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Agregar tarea
            </Button>
          </div>

          <AISummaryCard
            cacheKey={`accounting-period-${period.id}`}
            contextPrompt={periodPrompt}
            title={`Reporte IA — ${getMonthName(period.month)} ${period.year}`}
            ready={period.steps.length > 0}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AccountingDashboard({
  projectId,
  clientDropboxPath,
  clientId,
  projectArea,
}: {
  projectId: string;
  clientDropboxPath?: string;
  clientId?: string;
  /** Área del proyecto para el alta rápida de tareas (p. ej. contabilidad / softlanding). */
  projectArea?: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { canDeleteTasks } = useUserRole();
  const deleteTask = useDeleteTask();
  const { data: periods, isLoading } = useAccountingPeriods(projectId);
  const createPeriod = useCreateAccountingPeriod();
  const now = nowMX();
  const [newYear, setNewYear] = useState(now.getFullYear().toString());
  const [newMonth, setNewMonth] = useState((now.getMonth() + 1).toString());
  const [showCreate, setShowCreate] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskFormPhaseKey, setTaskFormPhaseKey] = useState<string | undefined>();

  const { data: profiles = [] } = useProfiles();
  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.user_id, p.full_name])), [profiles]);

  const { data: projectTasks = [] } = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });

  const [moffinBusy, setMoffinBusy] = useState<MoffinConsultType | null>(null);

  const { data: moffinRows = [] } = useQuery({
    queryKey: ["moffin-consults", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("moffin_consults")
        .select("id, consult_type, status, summary, created_at, document_id, documents(file_path, name)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!projectId,
  });

  const latestMoffinByType = useMemo(() => {
    const map = new Map<string, (typeof moffinRows)[number]>();
    for (const row of moffinRows) {
      if (!map.has(row.consult_type)) map.set(row.consult_type, row);
    }
    return map;
  }, [moffinRows]);

  const runMoffinConsult = useCallback(
    async (consultType: MoffinConsultType) => {
      if (
        !window.confirm(
          "Cada consulta puede generar un cargo según tu plan con Moffin. ¿Deseas continuar?"
        )
      ) {
        return;
      }
      setMoffinBusy(consultType);
      try {
        const { data, error } = await supabase.functions.invoke("moffin-query", {
          body: { projectId, consultType },
        });
        const payload = (data ?? {}) as {
          error?: string;
          message?: string;
          consult?: unknown;
          statusCode?: number;
        };
        if (error && !payload?.error && !payload?.consult) {
          throw new Error(error.message || "Error al invocar Moffin");
        }
        if (payload?.error) {
          toast.error(
            typeof payload.message === "string" ? payload.message : payload.error
          );
          if (payload.consult) {
            queryClient.invalidateQueries({ queryKey: ["moffin-consults", projectId] });
          }
          return;
        }
        toast.success("Consulta Moffin registrada");
        queryClient.invalidateQueries({ queryKey: ["moffin-consults", projectId] });
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Error al consultar Moffin");
      } finally {
        setMoffinBusy(null);
      }
    },
    [projectId, queryClient]
  );

  const downloadMoffinFile = useCallback(async (filePath: string | null | undefined) => {
    if (!filePath) return;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(filePath, 3600);
    if (error || !data?.signedUrl) {
      toast.error("No se pudo generar el enlace de descarga");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }, []);

  useEffect(() => {
    if (!periods?.length || !projectId) return;
    let cancelled = false;
    ensureAccountingPeriodPhasesOnProject(
      projectId,
      periods.map((p) => ({ id: p.id, month: p.month, year: p.year }))
    )
      .then((changed) => {
        if (!cancelled && changed) queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [periods, projectId, queryClient]);

  const handleCreate = () => {
    createPeriod.mutate(
      { projectId, year: parseInt(newYear), month: parseInt(newMonth) },
      { onSuccess: () => setShowCreate(false) }
    );
  };

  const openAddTaskForPeriod = useCallback((periodId: string) => {
    setTaskFormPhaseKey(accountingPeriodPhaseKey(periodId));
    setShowTaskForm(true);
  }, []);

  const totalPeriods = periods?.length ?? 0;
  const completedPeriods = periods?.filter((p) => p.status === "completado").length ?? 0;
  const inProgressPeriods = periods?.filter((p) => p.status === "en_progreso").length ?? 0;

  const generalPrompt = useMemo(
    () => (periods && periods.length > 0 ? buildGeneralPrompt(periods) : ""),
    [periods]
  );

  return (
    <div className="space-y-4">
      <CriticalityDelayCard projectId={projectId} />

      <Card className="border-border/80">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Consultas SAT (Moffin)</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xl">
                Lista 69-B vía <code className="text-[10px]">/query/sat_blacklist</code>. Constancia y opinión se obtienen del mismo servicio de certificados{" "}
                <code className="text-[10px]">/query/sat_rfc</code> (tipos en <code className="text-[10px]">certificates[].type</code>). Cada clic puede ser una
                consulta cobrable.
              </p>
            </div>
          </div>
          {!clientId ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Asocia un cliente con RFC al proyecto para usar estas consultas.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MOFFIN_CONSULT_META) as MoffinConsultType[]).map((key) => {
                const meta = MOFFIN_CONSULT_META[key];
                const Icon = meta.icon;
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={!!moffinBusy}
                    onClick={() => runMoffinConsult(key)}
                  >
                    {moffinBusy === key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                    {meta.short}
                  </Button>
                );
              })}
            </div>
          )}
          <div className="rounded-md border border-border/60 overflow-hidden">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Tipo</th>
                  <th className="p-2 font-medium">Último estado</th>
                  <th className="p-2 font-medium">Resumen</th>
                  <th className="p-2 font-medium">Fecha</th>
                  <th className="p-2 font-medium w-24">Archivo</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(MOFFIN_CONSULT_META) as MoffinConsultType[]).map((key) => {
                  const row = latestMoffinByType.get(key);
                  const doc = row?.documents as { file_path?: string | null; name?: string | null } | null;
                  return (
                    <tr key={key} className="border-t border-border/50">
                      <td className="p-2 font-medium">{MOFFIN_CONSULT_META[key].label}</td>
                      <td className="p-2">
                        {row ? (
                          <Badge variant={row.status === "success" ? "default" : "secondary"} className="text-[10px]">
                            {row.status}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground max-w-[220px] truncate" title={row?.summary ?? undefined}>
                        {row?.summary ?? "—"}
                      </td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        {row?.created_at ? new Date(row.created_at).toLocaleString("es-MX") : "—"}
                      </td>
                      <td className="p-2">
                        {doc?.file_path ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => downloadMoffinFile(doc.file_path)}
                            aria-label="Descargar PDF"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        Cada periodo mensual tiene su propia fase en el tab <strong className="text-foreground font-medium">Tareas</strong>: puedes crear varias tareas por mes y arrastrarlas entre fases allí.
      </div>
      {periods && periods.length > 0 && (
        <AISummaryCard
          cacheKey={`accounting-general-${projectId}`}
          contextPrompt={generalPrompt}
          title="Reporte General Kawiil AI — Contabilidad"
          ready={periods.length > 0}
        />
      )}

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{totalPeriods}</p>
            <p className="text-xs text-muted-foreground">Periodos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-accent-foreground">{inProgressPeriods}</p>
            <p className="text-xs text-muted-foreground">En progreso</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{completedPeriods}</p>
            <p className="text-xs text-muted-foreground">Completados</p>
          </CardContent>
        </Card>
      </div>

      {showCreate ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <label className="text-sm font-medium">Mes</label>
                <Select value={newMonth} onValueChange={setNewMonth}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i + 1} value={(i + 1).toString()}>
                        {getMonthName(i + 1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Año</label>
                <Select value={newYear} onValueChange={setNewYear}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                      <SelectItem key={y} value={y.toString()}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={createPeriod.isPending}>
                Crear
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo periodo mensual
        </Button>
      )}

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Cargando...</p>
      ) : !periods || periods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">Sin periodos contables. Crea el primer periodo para comenzar.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Periodos (vista por fases)</h3>
          {periods.map((period, idx) => {
            const pk = accountingPeriodPhaseKey(period.id);
            const periodTasks = projectTasks.filter((t: any) => t.phase_key === pk);
            return (
              <PeriodCard
                key={period.id}
                period={period}
                projectId={projectId}
                colorIndex={idx}
                clientDropboxPath={clientDropboxPath}
                clientId={clientId}
                periodTasks={periodTasks}
                profileMap={profileMap}
                onOpenAddTask={openAddTaskForPeriod}
                onTaskClick={(id) => setSelectedTaskId(id)}
                canDeleteTasks={canDeleteTasks}
                onDeleteTask={(id) => setDeleteTargetId(id)}
              />
            );
          })}
        </div>
      )}

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
        defaultArea={projectArea}
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
