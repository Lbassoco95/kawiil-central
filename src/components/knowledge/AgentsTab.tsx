import { useEffect, useRef } from "react";
import {
  useKnowledgeSyncLogs,
  useKnowledgeFeed,
  useRunKnowledgeSync,
  useRunningAgents,
  type KnowledgeSyncLog,
} from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot, Play, Loader2, CheckCircle2, XCircle,
  Clock, FileText, Lightbulb, Bell, AlertTriangle,
  Archive, Link, Sparkles,
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

export function AgentsTab() {
  const { data: logs, isLoading: logsLoading } = useKnowledgeSyncLogs();
  const { feed, isLoading: feedLoading } = useKnowledgeFeed();
  const runSync = useRunKnowledgeSync();
  const { running, isAnyRunning } = useRunningAgents();

  // Track previous log statuses to detect transitions
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
          description: formatStats(log),
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
                          .filter(([k]) => k !== "details")
                          .map(([k, v]) => (
                            <Badge key={k} variant="secondary" className="text-[9px]">
                              {k.replace(/_/g, " ")}: {String(v)}
                            </Badge>
                          ))}
                      </div>
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

      {/* Sync log timeline */}
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
            <div className="divide-y divide-border/50 max-h-60 sm:max-h-80 overflow-y-auto">
              {logs.map((log) => {
                const meta = agentMeta[log.agent];
                const Icon = meta?.icon || Bot;
                return (
                  <div key={log.id} className="flex items-center gap-2 sm:gap-3 py-2 text-xs">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${meta?.color || "text-gray-500"}`} />
                    <span className="font-medium w-16 sm:w-20 truncate">{meta?.label || log.agent}</span>
                    <Badge
                      variant={log.status === "completed" ? "default" : log.status === "failed" ? "destructive" : "secondary"}
                      className="text-[9px]"
                    >
                      {log.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />}
                      {log.status}
                    </Badge>
                    <span className="text-muted-foreground ml-auto text-[10px] sm:text-xs">
                      {new Date(log.started_at).toLocaleString("es-MX", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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

function formatStats(log: KnowledgeSyncLog): string {
  if (!log.stats) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(log.stats)) {
    if (k === "details" || k === "skipped") continue;
    parts.push(`${k.replace(/_/g, " ")}: ${v}`);
  }
  return parts.join(", ");
}
