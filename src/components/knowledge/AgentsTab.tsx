import { useState } from "react";
import {
  useKnowledgeSyncLogs,
  useKnowledgeFeed,
  useRunKnowledgeSync,
} from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const [runningAgent, setRunningAgent] = useState<string | null>(null);

  const handleRun = async (agent?: string) => {
    setRunningAgent(agent || "all");
    try {
      await runSync.mutateAsync(agent ? { agent } : undefined);
      toast.success(agent ? `Agente ${agentMeta[agent]?.label} ejecutado` : "Sincronización completa ejecutada");
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setRunningAgent(null);
    }
  };

  const lastRunByAgent = (agent: string) => {
    return logs?.find((l) => l.agent === agent);
  };

  return (
    <div className="space-y-6">
      {/* Agent cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {(["archivista", "integrador", "nutritor"] as const).map((agent, idx) => {
          const meta = agentMeta[agent];
          const Icon = meta.icon;
          const last = lastRunByAgent(agent);

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
                {last ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      {last.status === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      {last.status === "failed" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      {last.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
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
                ) : (
                  <p className="text-xs text-muted-foreground">Nunca ejecutado</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={runningAgent !== null}
                  onClick={() => handleRun(agent)}
                >
                  {runningAgent === agent ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-2" />
                  )}
                  Ejecutar
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
          disabled={runningAgent !== null}
          className="gap-2"
        >
          {runningAgent === "all" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
          Ejecutar todos los agentes
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
            <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
              {logs.map((log) => {
                const meta = agentMeta[log.agent];
                const Icon = meta?.icon || Bot;
                return (
                  <div key={log.id} className="flex items-center gap-3 py-2 text-xs">
                    <Icon className={`h-3.5 w-3.5 ${meta?.color || "text-gray-500"}`} />
                    <span className="font-medium w-20">{meta?.label || log.agent}</span>
                    <Badge
                      variant={log.status === "completed" ? "default" : log.status === "failed" ? "destructive" : "secondary"}
                      className="text-[9px]"
                    >
                      {log.status}
                    </Badge>
                    <span className="text-muted-foreground ml-auto">
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
            <div className="divide-y divide-border/50 max-h-96 overflow-y-auto">
              {feed.map((item) => {
                const FeedIcon = feedIcons[item.feed_type] || Bell;
                return (
                  <div key={item.id} className={`py-3 ${item.is_read ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-2">
                      <FeedIcon className="h-3.5 w-3.5 mt-0.5 text-primary" />
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
