import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  AlertTriangle,
  FileBadge,
  FileCheck2,
  Loader2,
  RefreshCw,
  Mail,
  ExternalLink,
  KeyRound,
} from "lucide-react";
import { differenceInMinutes } from "date-fns";
import { nowMX } from "@/lib/dateUtils";
import { MoffinPdfActions } from "@/components/clients/MoffinPdfActions";
import { moffinConsultNeedsApiSync, type MoffinConsultRow } from "@/lib/moffinDisplay";
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
import {
  functionInvokeUserMessageAsync,
  invokeFunctionWithSession,
} from "@/lib/supabaseInvoke";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MoffinSatCiecSection } from "./MoffinSatCiecSection";
import { MoffinSatStatusSummary } from "@/components/clients/MoffinSatStatusSummary";
import { MOFFIN_USE_SOLUTIONS } from "@/lib/moffinUseSolutions";
import { ComposeEmailDialog } from "@/components/microsoft/ComposeEmailDialog";

type MoffinConsultType = "lista_69b" | "constancia_situacion_fiscal" | "opinion_cumplimiento";

function moffinNeedsFiel(consultType: MoffinConsultType): boolean {
  if (consultType === "lista_69b") return false;
  if (MOFFIN_USE_SOLUTIONS) return false;
  return true;
}

function moffinNeedsCiec(consultType: MoffinConsultType): boolean {
  return MOFFIN_USE_SOLUTIONS && consultType !== "lista_69b";
}

const MOFFIN_CONSULT_META: Record<
  MoffinConsultType,
  { label: string; short: string; icon: typeof ShieldAlert }
> = {
  lista_69b: {
    label: "Lista 69-B (SAT)",
    short: "69-B",
    icon: ShieldAlert,
  },
  constancia_situacion_fiscal: {
    label: "Constancia de situación fiscal (SAT · Moffin)",
    short: "CSF",
    icon: FileBadge,
  },
  opinion_cumplimiento: {
    label: "Opinión de cumplimiento 32D (SAT · Moffin)",
    short: "32D",
    icon: FileCheck2,
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

function moffinFielPwSessionKey(clientId: string) {
  return `kawiil_moffin_fiel_pw_${clientId}`;
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
  const { user, session } = useAuth();
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

  const [composeOpen, setComposeOpen] = useState(false);

  const { data: clientInfo } = useQuery({
    queryKey: ["accounting-dashboard-client", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const { data, error } = await supabase
        .from("clients")
        .select("name, email")
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

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
  const [fielPassword, setFielPassword] = useState("");
  const [rememberFielPwSession, setRememberFielPwSession] = useState(false);
  const [moffinRefreshing, setMoffinRefreshing] = useState(false);

  const { data: moffinFielStatus } = useQuery({
    queryKey: ["moffin-fiel-status", clientId],
    queryFn: async () => {
      const { data, error } = await invokeFunctionWithSession("moffin-fiel", {
        action: "status",
        clientId: clientId!,
      });
      if (error) {
        throw new Error(await functionInvokeUserMessageAsync(data, error));
      }
      const payload = (data ?? {}) as {
        configured?: boolean;
        certFingerprint?: string | null;
        updatedAt?: string | null;
        error?: string;
        message?: string;
      };
      if (payload.error) {
        throw new Error(typeof payload.message === "string" ? payload.message : payload.error);
      }
      return {
        configured: !!payload.configured,
        certFingerprint: payload.certFingerprint ?? null,
        updatedAt: payload.updatedAt ?? null,
      };
    },
    enabled: !!user && !!session?.access_token && !!clientId && !MOFFIN_USE_SOLUTIONS,
  });

  const { data: moffinCiecStatus } = useQuery({
    queryKey: ["moffin-sat-ciec-status", clientId],
    queryFn: async () => {
      const { data, error } = await invokeFunctionWithSession("moffin-sat-ciec", {
        action: "status",
        clientId: clientId!,
      });
      if (error) {
        throw new Error(await functionInvokeUserMessageAsync(data, error));
      }
      const payload = (data ?? {}) as {
        configured?: boolean;
        profileId?: number | null;
        updatedAt?: string | null;
        error?: string;
        message?: string;
      };
      if (payload.error) {
        throw new Error(typeof payload.message === "string" ? payload.message : payload.error);
      }
      return {
        configured: !!payload.configured,
        profileId: payload.profileId ?? null,
        updatedAt: payload.updatedAt ?? null,
      };
    },
    enabled: !!user && !!session?.access_token && !!clientId && MOFFIN_USE_SOLUTIONS,
  });

  useEffect(() => {
    if (!clientId || MOFFIN_USE_SOLUTIONS) {
      setFielPassword("");
      setRememberFielPwSession(false);
      return;
    }
    try {
      const stored = sessionStorage.getItem(moffinFielPwSessionKey(clientId));
      if (stored !== null && stored !== "") {
        setFielPassword(stored);
        setRememberFielPwSession(true);
      } else {
        setFielPassword("");
        setRememberFielPwSession(false);
      }
    } catch {
      setFielPassword("");
      setRememberFielPwSession(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !rememberFielPwSession || MOFFIN_USE_SOLUTIONS) return;
    try {
      if (fielPassword) sessionStorage.setItem(moffinFielPwSessionKey(clientId), fielPassword);
      else sessionStorage.removeItem(moffinFielPwSessionKey(clientId));
    } catch {
      /* ignore */
    }
  }, [clientId, rememberFielPwSession, fielPassword]);

  const { data: moffinRows = [] } = useQuery({
    queryKey: ["moffin-consults", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("moffin_consults")
        .select(
          "id, consult_type, status, summary, created_at, document_id, error_message, moffin_query_id, documents(file_path, name)"
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as MoffinConsultRow[];
    },
    enabled: !!user && !!projectId,
    refetchInterval: false,
  });

  const latestMoffinByType = useMemo(() => {
    const map = new Map<string, MoffinConsultRow>();
    for (const row of moffinRows) {
      if (!map.has(row.consult_type)) map.set(row.consult_type, row);
    }
    return map;
  }, [moffinRows]);

  const hasPendingMoffinSync = useMemo(
    () => moffinRows.some((r) => moffinConsultNeedsApiSync(r)),
    [moffinRows],
  );

  useEffect(() => {
    if (!user || !projectId || !hasPendingMoffinSync) return;
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["moffin-consults", projectId] });
    }, 55_000);
    return () => clearInterval(id);
  }, [user, projectId, hasPendingMoffinSync, queryClient]);

  const moffinStalePending = useMemo(() => {
    const keys = Object.keys(MOFFIN_CONSULT_META) as MoffinConsultType[];
    return keys.some((key) => {
      const row = latestMoffinByType.get(key);
      return (
        !!row &&
        row.status === "pending" &&
        !!row.moffin_query_id &&
        !!row.created_at &&
        differenceInMinutes(new Date(), new Date(row.created_at)) >= 10
      );
    });
  }, [latestMoffinByType]);

  const syncMoffinPending = useCallback(async () => {
    setMoffinRefreshing(true);
    try {
      const { data, error } = await invokeFunctionWithSession("moffin-query", {
        refreshPendingForProjectId: projectId,
      });
      const payload = (data ?? {}) as {
        refresh?: boolean;
        results?: Array<{ ok: boolean; error?: string; newStatus?: string }>;
        pendingFound?: number;
        error?: string;
        message?: string;
      };
      if (payload.error || error) {
        toast.error(await functionInvokeUserMessageAsync(data, error));
        return;
      }
      const failed = payload.results?.filter((r) => !r.ok) ?? [];
      const okRows = payload.results?.filter((r) => r.ok) ?? [];
      const stillPending = okRows.filter((r) => r.newStatus === "pending").length;
      if (failed.length) {
        toast.warning(`Sincronización parcial: ${failed[0]?.error ?? "revisa respuesta de Moffin"}`);
      } else if (payload.pendingFound === 0) {
        toast.success("No había filas que requieran sincronizar con Moffin.");
      } else if (stillPending > 0) {
        toast("Sincronización lista — Moffin en cola", {
          description: `Es el comportamiento esperado: ${stillPending} consulta(s) siguen en cola en Moffin, la tabla en pendiente y sin PDF hasta que pasen a éxito. No es un error. Si el webhook (Svix) está configurado, se actualizará solo; si no, vuelve a sincronizar más tarde.`,
        });
      } else {
        toast.success("Consultas actualizadas desde Moffin (resultado listo; si tu plan entrega PDF, se sube al pasar a éxito).");
      }
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["moffin-consults", projectId] }),
        clientId
          ? queryClient.refetchQueries({ queryKey: ["moffin-consults-client", clientId] })
          : Promise.resolve(),
      ]);
      if (clientId) {
        void queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al sincronizar Moffin");
    } finally {
      setMoffinRefreshing(false);
    }
  }, [projectId, clientId, queryClient]);

  const runMoffinConsult = useCallback(
    async (consultType: MoffinConsultType) => {
      if (moffinNeedsCiec(consultType)) {
        if (!moffinCiecStatus?.configured) {
          toast.error("Primero guarda la CIEC del cliente (Moffin Solutions) en el bloque de credenciales SAT.");
          return;
        }
      }
      if (moffinNeedsFiel(consultType)) {
        if (!moffinFielStatus?.configured) {
          toast.error("Primero carga el .cer y el .key del cliente en el bloque de e.firma.");
          return;
        }
        if (!fielPassword.trim()) {
          toast.error("Ingresa la contraseña de la e.firma para esta consulta.");
          return;
        }
      }
      if (
        !window.confirm(
          "Cada consulta puede generar un cargo según tu plan con Moffin. ¿Deseas continuar?"
        )
      ) {
        return;
      }
      setMoffinBusy(consultType);
      try {
        const { data, error } = await invokeFunctionWithSession("moffin-query", {
          projectId,
          consultType,
          ...(moffinNeedsFiel(consultType)
            ? { fielPassword: fielPassword.trim() }
            : {}),
        });
        const payload = (data ?? {}) as {
          error?: string;
          message?: string;
          consult?: unknown;
          statusCode?: number;
        };
        if (payload.error || error) {
          toast.error(await functionInvokeUserMessageAsync(data, error));
          const errCode = String((payload as { error?: string }).error ?? "");
          const scrollCiec =
            MOFFIN_USE_SOLUTIONS &&
            clientId &&
            ["moffin_profile_failed", "moffin_profile_invalid", "ciec_decrypt_failed"].includes(errCode);
          if (scrollCiec) {
            queryClient.invalidateQueries({ queryKey: ["moffin-sat-ciec-status", clientId] });
            requestAnimationFrame(() => {
              document.getElementById("moffin-sat-ciec-section")?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
              });
            });
          }
          if (payload.consult) {
            queryClient.invalidateQueries({ queryKey: ["moffin-consults", projectId] });
            if (clientId) {
              queryClient.invalidateQueries({ queryKey: ["moffin-consults-client", clientId] });
              queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
            }
          }
          return;
        }
        toast.success("Consulta Moffin registrada");
        queryClient.invalidateQueries({ queryKey: ["moffin-consults", projectId] });
        if (clientId) {
          queryClient.invalidateQueries({ queryKey: ["moffin-consults-client", clientId] });
          queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
        }
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Error al consultar Moffin");
      } finally {
        setMoffinBusy(null);
      }
    },
    [projectId, clientId, queryClient, moffinFielStatus?.configured, moffinCiecStatus?.configured, fielPassword]
  );

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
      {/* AI Summary — siempre arriba para que la lectura inicie en la IA */}
      {periods && periods.length > 0 && (
        <AISummaryCard
          cacheKey={`accounting-general-${projectId}`}
          contextPrompt={generalPrompt}
          title="Reporte General Kawiil AI — Contabilidad"
          ready={periods.length > 0}
        />
      )}

      {clientId ? (
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setComposeOpen(true)}
            className="gap-2"
          >
            <Mail className="h-4 w-4" />
            Enviar correo al cliente
          </Button>
          <ComposeEmailDialog
            open={composeOpen}
            onOpenChange={setComposeOpen}
            initialTo={clientInfo?.email || ""}
            defaultTemplateContext={{
              razon_social: clientInfo?.name || "",
              clientId,
              projectId,
            }}
          />
        </div>
      ) : null}
      <CriticalityDelayCard projectId={projectId} />

      <Card className="border-border/80">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Consultas SAT (Moffin)</h3>
          {!MOFFIN_USE_SOLUTIONS ? (
            <Alert variant="default" className="border-amber-500/40 bg-amber-500/5 py-3 [&>svg]:top-3.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-xs font-semibold">Modo legacy explícito (FIEL)</AlertTitle>
              <AlertDescription className="text-[11px] leading-snug text-muted-foreground space-y-1.5">
                <p>
                  Este build tiene <code className="rounded bg-muted px-1 py-0.5 text-[10px]">VITE_MOFFIN_API_FLAVOR=legacy</code>
                  : CSF y 32D usan e.firma (.cer/.key) y <code className="rounded bg-muted px-1 py-0.5 text-[10px]">sat_rfc</code>, no
                  la API Moffin Solutions con CIEC.
                </p>
                <p>
                  Para volver al flujo predeterminado (CIEC + Solutions): quita{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">VITE_MOFFIN_API_FLAVOR=legacy</code> del entorno de
                  build (por defecto la app ya usa Solutions). En Supabase elimina{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">MOFFIN_API_FLAVOR=legacy</code> y configura los
                  secretos de Solutions (ver <code className="rounded bg-muted px-1 py-0.5 text-[10px]">.env.example</code>).
                </p>
              </AlertDescription>
            </Alert>
          ) : null}
          {clientId ? (
            <p className="text-[10px] text-muted-foreground leading-snug">
              {MOFFIN_USE_SOLUTIONS ? (
                <>
                  Por defecto, CSF y 32D usan la API Moffin Solutions (perfil SAT con CIEC). Lista 69-B sigue en la API legacy
                  en <code className="text-[9px]">MOFFIN_LEGACY_BASE_URL</code> si aplica.
                </>
              ) : (
                <>
                  «CSF» y «32D» aquí usan FIEL (build con <code className="text-[9px]">VITE_MOFFIN_API_FLAVOR=legacy</code>).
                </>
              )}
            </p>
          ) : null}
          {clientId ? (
            <>
              <MoffinSatStatusSummary
                clientId={clientId}
                title="Resumen para este cliente"
                className="bg-muted/15 border-border/70"
              />
            </>
          ) : null}
          {clientId ? (
            <div className="space-y-3">
              {MOFFIN_USE_SOLUTIONS ? (
                <MoffinSatCiecSection clientId={clientId} />
              ) : (
                <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-medium text-foreground">
                      e.firma (FIEL) y sellos digitales
                    </span>
                    {moffinFielStatus?.configured ? (
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                        FIEL registrada
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-700 dark:text-amber-400">
                        Sin FIEL cargada
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Los certificados SAT se administran desde la ficha del cliente (pestaña General). Ahí se
                    registran la e.firma y los sellos digitales con su vigencia y avisos automáticos.
                  </p>
                  <a
                    href={`/clientes/${clientId}?tab=general#sat-certificates`}
                    className="inline-flex items-center gap-1.5 text-[10px] font-medium text-primary hover:underline"
                  >
                    Ir a la ficha del cliente
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {!MOFFIN_USE_SOLUTIONS && moffinFielStatus?.configured ? (
                <div className="space-y-2 max-w-sm">
                  <Label htmlFor="moffin-fiel-password" className="text-[10px] text-muted-foreground">
                    Contraseña de la llave (.key) para esta consulta
                  </Label>
                  <Input
                    id="moffin-fiel-password"
                    type="password"
                    autoComplete="new-password"
                    className="h-8 text-xs"
                    placeholder="Requerida para las consultas RFC (constancia / opinión)"
                    value={fielPassword}
                    onChange={(e) => setFielPassword(e.target.value)}
                  />
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="moffin-fiel-remember-session"
                      checked={rememberFielPwSession}
                      onCheckedChange={(c) => {
                        const on = c === true;
                        setRememberFielPwSession(on);
                        if (!on && clientId) {
                          try {
                            sessionStorage.removeItem(moffinFielPwSessionKey(clientId));
                          } catch {
                            /* ignore */
                          }
                        }
                      }}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="moffin-fiel-remember-session"
                      className="text-[10px] text-muted-foreground font-normal leading-snug cursor-pointer"
                    >
                      Recordar contraseña en esta sesión del navegador (solo en tu equipo; al cerrar la pestaña suele
                      borrarse)
                    </Label>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {!clientId ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Asocia un cliente con RFC al proyecto para usar estas consultas.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MOFFIN_CONSULT_META) as MoffinConsultType[]).map((key) => {
                const meta = MOFFIN_CONSULT_META[key];
                const Icon = meta.icon;
                const needsCert = moffinNeedsFiel(key);
                const needsCiecSat = moffinNeedsCiec(key);
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={
                      !!moffinBusy ||
                      (needsCert && !moffinFielStatus?.configured) ||
                      (needsCiecSat && !moffinCiecStatus?.configured)
                    }
                    title={
                      needsCiecSat && !moffinCiecStatus?.configured
                        ? "Guarda la CIEC del cliente antes de consultar"
                        : needsCert && !moffinFielStatus?.configured
                          ? "Carga .cer y .key antes de consultar"
                          : undefined
                    }
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
          {clientId && moffinStalePending ? (
            <p className="text-[11px] text-amber-900 dark:text-amber-100 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-2 leading-snug">
              Consultas SAT en <strong className="font-medium">pendiente</strong> desde hace varios minutos: mientras
              Moffin responda con el patrón de cola, el estado correcto es pendiente (aún no hay PDF). Revisa que el
              webhook de Moffin (Svix) entregue el resultado final; si no llega, usa{" "}
              <strong className="font-medium">Sincronizar pendientes</strong> para leer el estado en la API cuando ya
              haya resultado.
            </p>
          ) : null}
          {clientId && hasPendingMoffinSync ? (
            <div className="flex flex-col items-end gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 text-xs gap-1"
                disabled={moffinRefreshing}
                onClick={syncMoffinPending}
              >
                {moffinRefreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sincronizar pendientes (Moffin API)
              </Button>
              <p className="text-[10px] text-muted-foreground text-right max-w-md leading-snug">
                Pendiente = en cola en Moffin; el PDF solo aplica cuando el estado pase a éxito y tu plan/API lo
                entreguen. Sin webhook, los cambios se verán al pulsar sincronizar cuando el resultado esté listo.
              </p>
            </div>
          ) : null}
          <p className="text-[10px] text-muted-foreground font-medium">Vista rápida (última consulta por tipo)</p>
          <div className="rounded-md border border-border/60 overflow-hidden">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Tipo</th>
                  <th className="p-2 font-medium">Último estado</th>
                  <th className="p-2 font-medium">Resumen</th>
                  <th className="p-2 font-medium">Fecha</th>
                  <th className="p-2 font-medium min-w-[140px]">PDF</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(MOFFIN_CONSULT_META) as MoffinConsultType[]).map((key) => {
                  const row = latestMoffinByType.get(key);
                  const doc = row?.documents as { file_path?: string | null; name?: string | null } | null;
                  const statusBadgeVariant =
                    row?.status === "success"
                      ? "default"
                      : row?.status === "fail" || row?.status === "error"
                        ? "destructive"
                        : "secondary";
                  return (
                    <tr key={key} className="border-t border-border/50">
                      <td className="p-2 font-medium">{MOFFIN_CONSULT_META[key].label}</td>
                      <td className="p-2">
                        {row ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant={statusBadgeVariant} className="text-[10px]">
                              {row.status}
                            </Badge>
                            {(row.status === "fail" || row.status === "error") &&
                            row.error_message?.trim().startsWith("Origen:") ? (
                              <span className="text-[9px] font-medium text-muted-foreground rounded border border-border/60 px-1 py-0">
                                Moffin
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground max-w-[260px]">
                        <div className="truncate" title={row?.summary ?? undefined}>
                          {row?.summary ?? "—"}
                        </div>
                        {row?.error_message ? (
                          <div className="text-[10px] text-destructive mt-0.5 leading-tight line-clamp-2">
                            {row.error_message}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        {row?.created_at ? new Date(row.created_at).toLocaleString("es-MX") : "—"}
                      </td>
                      <td className="p-2 align-top">
                        {doc?.file_path ? (
                          <MoffinPdfActions filePath={doc.file_path} fileName={doc.name} />
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
          {clientId && moffinRows.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground font-medium pt-2">
                Historial de consultas (cada fila es una ejecución; conserva PDFs previos)
              </p>
              <div className="rounded-md border border-border/60 overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-[1]">
                    <tr>
                      <th className="p-2 font-medium">Tipo</th>
                      <th className="p-2 font-medium">Estado</th>
                      <th className="p-2 font-medium">Resumen</th>
                      <th className="p-2 font-medium">Fecha</th>
                      <th className="p-2 font-medium min-w-[140px]">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moffinRows.map((hist) => {
                      const hdoc = hist.documents as {
                        file_path?: string | null;
                        name?: string | null;
                      } | null;
                      const histLabel =
                        MOFFIN_CONSULT_META[hist.consult_type as MoffinConsultType]?.label ??
                        hist.consult_type;
                      const histBadgeVariant =
                        hist.status === "success"
                          ? "default"
                          : hist.status === "fail" || hist.status === "error"
                            ? "destructive"
                            : "secondary";
                      return (
                        <tr key={hist.id} className="border-t border-border/50">
                          <td className="p-2 font-medium align-top">{histLabel}</td>
                          <td className="p-2 align-top">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant={histBadgeVariant} className="text-[10px]">
                                {hist.status}
                              </Badge>
                              {(hist.status === "fail" || hist.status === "error") &&
                              hist.error_message?.trim().startsWith("Origen:") ? (
                                <span className="text-[9px] font-medium text-muted-foreground rounded border border-border/60 px-1 py-0">
                                  Moffin
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-2 text-muted-foreground max-w-[220px] align-top">
                            <div className="line-clamp-2" title={hist.summary ?? undefined}>
                              {hist.summary ?? "—"}
                            </div>
                            {hist.error_message ? (
                              <div className="text-[10px] text-destructive mt-0.5 leading-tight line-clamp-2">
                                {hist.error_message}
                              </div>
                            ) : null}
                          </td>
                          <td className="p-2 text-muted-foreground whitespace-nowrap align-top">
                            {hist.created_at ? new Date(hist.created_at).toLocaleString("es-MX") : "—"}
                          </td>
                          <td className="p-2 align-top">
                            {hdoc?.file_path ? (
                              <MoffinPdfActions filePath={hdoc.file_path} fileName={hdoc.name} />
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
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        Cada periodo mensual tiene su propia fase en el tab <strong className="text-foreground font-medium">Tareas</strong>: puedes crear varias tareas por mes y arrastrarlas entre fases allí.
      </div>

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
