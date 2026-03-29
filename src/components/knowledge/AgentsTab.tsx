import { useEffect, useRef, useState } from "react";
import {
  useKnowledgeSyncLogs,
  useKnowledgeFeed,
  useRunKnowledgeSync,
  useRunningAgents,
  useLearningProgress,
  type KnowledgeSyncLog,
} from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Bot, Play, Loader2, CheckCircle2, XCircle,
  Clock, FileText, Lightbulb, Bell, AlertTriangle,
  Archive, Link, Sparkles, ChevronRight, Timer, AlertOctagon,
  Database, Building2, FolderKanban, BrainCircuit,
} from "lucide-react";
import { toast } from "sonner";

const agentMeta: Record<string, { label: string; icon: typeof Archive; color: string; desc: string }> = {
  archivista: {
    label: "Archivista",
    icon: Archive,
    color: "text-blue-500",
    desc: "Escanea Dropbox, clasifica documentos, genera embeddings",
  },
  integrador: {
    label: "Integrador",
    icon: Link,
    color: "text-emerald-500",
    desc: "Analiza chunks por cliente/proyecto y genera perfiles de conocimiento",
  },
  nutritor: {
    label: "Nutritor",
    icon: Sparkles,
    color: "text-amber-500",
    desc: "Genera feed de novedades, recomendaciones y briefings diarios",
  },
};

const feedIcons: Record<string, typeof FileText> = {
  new_document: FileText,
  insight: Lightbulb,
  recommendation: Bell,
  alert: AlertTriangle,
};

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function formatStatsLine(log: KnowledgeSyncLog): string {
  if (!log.stats) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(log.stats)) {
    if (k === "details" || k === "skipped" || k === "breakdown" || k === "reason") continue;
    parts.push(`${k.replace(/_/g, " ")}: ${v}`);
  }
  return parts.join(" · ");
}

function LogDetailPanel({ log }: { log: KnowledgeSyncLog }) {
  const details: any[] = log.stats?.details || [];
  const hasErrors = details.some((d: any) => d.error);

  return (
    <div className="pl-7 pr-2 pb-3 space-y-3 text-xs">
      {log.error_message && (
        <div className="flex items-start gap-2 p-2.5 bg-destructive/10 border border-destructive/20 rounded-md">
          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Error</p>
            <p className="text-muted-foreground mt-0.5">{log.error_message}</p>
          </div>
        </div>
      )}

      {log.stats && Object.keys(log.stats).length > 0 && (
        <div className="space-y-1.5">
          <p className="font-medium text-muted-foreground">Estadísticas</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(log.stats)
              .filter(([k]) => k !== "details" && k !== "breakdown")
              .map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-[10px]">
                  {k.replace(/_/g, " ")}: {String(v)}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {log.stats?.breakdown && (
        <div className="space-y-1.5">
          <p className="font-medium text-muted-foreground">Desglose</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(log.stats.breakdown as Record<string, number>)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-[10px]">
                  {k}: {v}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {details.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-medium text-muted-foreground flex items-center gap-1.5">
            Detalle por item
            {hasErrors && <AlertTriangle className="h-3 w-3 text-amber-500" />}
          </p>
          <div className="border rounded-md divide-y divide-border/50 max-h-48 overflow-y-auto">
            {details.map((item: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                {item.error ? (
                  <XCircle className="h-3 w-3 text-destructive shrink-0" />
                ) : item.skipped ? (
                  <span className="h-3 w-3 rounded-full bg-muted-foreground/30 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                )}
                <span className="font-medium truncate flex-1">
                  {item.client_name || item.project_name || item.name || item.title || `Item ${idx + 1}`}
                </span>
                {item.docs_indexed != null && (
                  <span className="text-muted-foreground">{item.docs_indexed} docs</span>
                )}
                {item.chunks != null && (
                  <span className="text-muted-foreground">{item.chunks} chunks</span>
                )}
                {item.insight_generated === true && (
                  <Badge variant="default" className="text-[9px] h-4">insight</Badge>
                )}
                {item.insight_generated === false && !item.error && !item.skipped && (
                  <Badge variant="secondary" className="text-[9px] h-4">sin insight</Badge>
                )}
                {item.error && (
                  <span className="text-destructive truncate max-w-[200px]">{item.error}</span>
                )}
                {item.type && (
                  <Badge variant="outline" className="text-[9px] h-4">{item.type}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
        <span>Inicio: {new Date(log.started_at).toLocaleString("es-MX")}</span>
        {log.completed_at && (
          <span>Fin: {new Date(log.completed_at).toLocaleString("es-MX")}</span>
        )}
        <span className="flex items-center gap-1">
          <Timer className="h-2.5 w-2.5" />
          {formatDuration(log.started_at, log.completed_at)}
        </span>
      </div>
    </div>
  );
}

function LearningProgressPanel() {
  const { data: progress, isLoading } = useLearningProgress();

  if (isLoading) {
    return <Skeleton className="h-32 rounded-xl" />;
  }

  if (!progress) return null;

  const clientCoverage = progress.totalClients > 0
    ? Math.round((progress.clientsWithChunks / progress.totalClients) * 100)
    : 0;
  const projectCoverage = progress.totalProjects > 0
    ? Math.round((progress.projectsWithChunks / progress.totalProjects) * 100)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" /> Progreso de aprendizaje
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold">{progress.totalDocs}</p>
            <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
              <FileText className="h-3 w-3" /> Documentos
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{progress.totalChunks.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
              <Database className="h-3 w-3" /> Chunks
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{progress.totalInsights}</p>
            <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
              <Lightbulb className="h-3 w-3" /> Insights
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{progress.totalFeedItems}</p>
            <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
              <Bell className="h-3 w-3" /> Novedades
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-blue-500" />
                Clientes con conocimiento
              </span>
              <span className="font-medium">{progress.clientsWithChunks}/{progress.totalClients} ({clientCoverage}%)</span>
            </div>
            <Progress value={clientCoverage} className="h-2" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <FolderKanban className="h-3 w-3 text-emerald-500" />
                Proyectos con conocimiento
              </span>
              <span className="font-medium">{progress.projectsWithChunks}/{progress.totalProjects} ({projectCoverage}%)</span>
            </div>
            <Progress value={projectCoverage} className="h-2" />
          </div>
        </div>

        {progress.lastSyncAt && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-1 border-t border-border/30">
            <Clock className="h-2.5 w-2.5" />
            Última sincronización: {new Date(progress.lastSyncAt).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AgentsTab() {
  const { data: logs, isLoading: logsLoading } = useKnowledgeSyncLogs();
  const { feed, isLoading: feedLoading } = useKnowledgeFeed();
  const runSync = useRunKnowledgeSync();
  const { running, isAnyRunning } = useRunningAgents();
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const prevLogsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!logs) return;
    const prevStatuses = prevLogsRef.current;
    const newStatuses: Record<string, string> = {};

    for (const log of logs) {
      newStatuses[log.id] = log.status;
      const prev = prevStatuses[log.id];
      if (prev === "running" && log.status === "completed") {
        const meta = agentMeta[log.agent];
        toast.success(`${meta?.label || log.agent} completado`, {
          description: formatStatsLine(log),
        });
      } else if (prev === "running" && log.status === "failed") {
        const meta = agentMeta[log.agent];
        toast.error(`${meta?.label || log.agent} falló`, {
          description: log.error_message || "Error desconocido",
        });
      }
    }

    prevLogsRef.current = newStatuses;
  }, [logs]);

  const handleRun = (agent?: string) => {
    const label = agent ? agentMeta[agent]?.label : "todos los agentes";
    toast.info(`Iniciando ${label}...`, {
      description: "El procesamiento puede tardar unos minutos.",
    });
    runSync.mutate(agent ? { agent } : undefined, {
      onSuccess: (data: any) => {
        if (data?.error) {
          toast.error(`Error del servidor: ${data.error}`);
        } else {
          const completed = data?.results
            ? Object.keys(data.results).map((k) => agentMeta[k]?.label || k).join(", ")
            : label;
          toast.success(`${completed} completado(s)`, {
            description: "Revisa el historial para más detalles.",
          });
        }
      },
      onError: (err: any) => {
        toast.error("Error al ejecutar agentes", {
          description: err?.message || "No se pudo conectar con el servidor.",
        });
      },
    });
  };

  const isMutationPending = runSync.isPending;
  const isAgentRunning = (agent: string) => running.includes(agent);
  const isAnythingActive = isAnyRunning || isMutationPending;

  const lastRunByAgent = (agent: string) => {
    return logs?.find((l) => l.agent === agent);
  };

  // Error appendix: logs that failed or have errors in details
  const errorLogs = (logs || []).filter((log) => {
    if (log.status === "failed") return true;
    const details: any[] = log.stats?.details || [];
    return details.some((d: any) => d.error);
  });

  return (
    <div className="space-y-6">
      {/* Agent cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {(["archivista", "integrador", "nutritor"] as const).map((agent, idx) => {
          const meta = agentMeta[agent];
          const Icon = meta.icon;
          const last = lastRunByAgent(agent);
          const isRunning = isAgentRunning(agent);

          return (
            <Card key={agent} className={`animate-fade-in stagger-${idx + 1}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${meta.color}`} />
                  {meta.label}
                </CardTitle>
                <p className="text-[11px] text-muted-foreground">{meta.desc}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {isRunning && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-blue-600">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Ejecutando...</span>
                    </div>
                    <Progress value={undefined} className="h-1.5 animate-pulse" />
                  </div>
                )}

                {!isRunning && last ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      {last.status === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      {last.status === "failed" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      <span className="capitalize">{last.status}</span>
                      {last.completed_at && (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Timer className="h-2.5 w-2.5" />
                          {formatDuration(last.started_at, last.completed_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(last.started_at).toLocaleString("es-MX", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {last.stats && Object.keys(last.stats).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(last.stats)
                          .filter(([k]) => k !== "details" && k !== "breakdown")
                          .map(([k, v]) => (
                            <Badge key={k} variant="secondary" className="text-[9px]">
                              {k.replace(/_/g, " ")}: {String(v)}
                            </Badge>
                          ))}
                      </div>
                    )}
                    {last.error_message && (
                      <p className="text-[10px] text-destructive mt-1 line-clamp-2">{last.error_message}</p>
                    )}
                  </div>
                ) : !isRunning ? (
                  <p className="text-xs text-muted-foreground">Nunca ejecutado</p>
                ) : null}

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={isAnythingActive}
                  onClick={() => handleRun(agent)}
                >
                  {isRunning || (isMutationPending && !isAnyRunning) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-2" />
                  )}
                  {isRunning ? "En progreso..." : isMutationPending ? "Iniciando..." : "Ejecutar"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Learning progress */}
      <LearningProgressPanel />

      {/* Run all button */}
      <div className="flex justify-center">
        <Button
          onClick={() => handleRun()}
          disabled={isAnythingActive}
          className="gap-2"
        >
          {isAnythingActive ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
          {isAnythingActive ? "Agentes en ejecución..." : "Ejecutar todos los agentes"}
        </Button>
      </div>

      {/* Sync log timeline — expandable */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" /> Historial de sincronización
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 rounded" />
              ))}
            </div>
          ) : !logs?.length ? (
            <p className="text-xs text-muted-foreground text-center py-6">Sin registros de sincronización</p>
          ) : (
            <div className="divide-y divide-border/50 max-h-[32rem] overflow-y-auto">
              {logs.map((log) => {
                const meta = agentMeta[log.agent];
                const Icon = meta?.icon || Bot;
                const isExpanded = expandedLogId === log.id;
                const statsLine = formatStatsLine(log);
                const hasDetailErrors = (log.stats?.details || []).some((d: any) => d.error);

                return (
                  <Collapsible
                    key={log.id}
                    open={isExpanded}
                    onOpenChange={() => setExpandedLogId(isExpanded ? null : log.id)}
                  >
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-center gap-2 sm:gap-3 py-2.5 px-1 text-xs hover:bg-muted/50 rounded transition-colors">
                        <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${meta?.color || "text-gray-500"}`} />
                        <span className="font-medium w-16 sm:w-20 truncate text-left">{meta?.label || log.agent}</span>
                        <Badge
                          variant={log.status === "completed" ? "default" : log.status === "failed" ? "destructive" : "secondary"}
                          className="text-[9px]"
                        >
                          {log.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />}
                          {log.status}
                        </Badge>
                        {hasDetailErrors && log.status !== "failed" && (
                          <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                        )}
                        {log.completed_at && (
                          <span className="text-muted-foreground flex items-center gap-0.5 text-[10px]">
                            <Timer className="h-2.5 w-2.5" />
                            {formatDuration(log.started_at, log.completed_at)}
                          </span>
                        )}
                        {statsLine && (
                          <span className="text-muted-foreground text-[10px] truncate hidden sm:inline max-w-[200px]">
                            {statsLine}
                          </span>
                        )}
                        <span className="text-muted-foreground ml-auto text-[10px] sm:text-xs shrink-0">
                          {new Date(log.started_at).toLocaleString("es-MX", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <LogDetailPanel log={log} />
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error appendix */}
      {errorLogs.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-destructive" />
              Apéndice de errores
              <Badge variant="destructive" className="text-[10px] ml-1">{errorLogs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/50 max-h-60 overflow-y-auto">
              {errorLogs.map((log) => {
                const meta = agentMeta[log.agent];
                const Icon = meta?.icon || Bot;
                const detailErrors = (log.stats?.details || []).filter((d: any) => d.error);

                return (
                  <div key={log.id} className="py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${meta?.color || "text-gray-500"}`} />
                      <span className="font-medium">{meta?.label || log.agent}</span>
                      <Badge variant="destructive" className="text-[9px]">{log.status}</Badge>
                      <span className="text-muted-foreground ml-auto text-[10px]">
                        {new Date(log.started_at).toLocaleString("es-MX", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {log.error_message && (
                      <p className="text-[11px] text-destructive pl-6">{log.error_message}</p>
                    )}
                    {detailErrors.length > 0 && (
                      <div className="pl-6 space-y-0.5">
                        {detailErrors.map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-1.5 text-[10px]">
                            <XCircle className="h-2.5 w-2.5 text-destructive shrink-0" />
                            <span className="font-medium">{item.client_name || item.project_name || `Item ${idx + 1}`}</span>
                            <span className="text-muted-foreground truncate">{item.error}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell className="h-4 w-4" /> Feed de novedades
          </CardTitle>
        </CardHeader>
        <CardContent>
          {feedLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded" />
              ))}
            </div>
          ) : !feed?.length ? (
            <p className="text-xs text-muted-foreground text-center py-6">Sin novedades. Ejecuta los agentes para generar contenido.</p>
          ) : (
            <div className="divide-y divide-border/50 max-h-72 sm:max-h-96 overflow-y-auto">
              {feed.map((item) => {
                const FeedIcon = feedIcons[item.feed_type] || Bell;
                return (
                  <div key={item.id} className={`py-3 ${item.is_read ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-2">
                      <FeedIcon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{item.title}</p>
                        {item.summary && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{item.summary}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {new Date(item.created_at).toLocaleString("es-MX")}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
