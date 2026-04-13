import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  useClientKnowledgeStats,
  useKnowledgeInsights,
  useRecentChunksForClient,
  useKnowledgeFeedForClient,
  type ClientKnowledgeStat,
} from "@/hooks/useKnowledge";
import { KnowledgeInsightCard } from "@/components/knowledge/KnowledgeInsightCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Building2, FileText, Scale, ShieldCheck, ExternalLink,
  ChevronDown, ChevronRight, Layers, Clock, Lightbulb, Rss, Code2,
} from "lucide-react";
import {
  METRIC_LABELS,
  RELATIVE_VOLUME_BAR_HINT,
  RELATIVE_VOLUME_BAR_LABEL,
  getSourceTypeCopy,
  formatFeedType,
  truncateChunkText,
  readKnowledgeTechnicalMode,
  writeKnowledgeTechnicalMode,
} from "@/lib/knowledgeLabels";
import { cn } from "@/lib/utils";

const areaConfig: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  contabilidad: { icon: FileText, color: "text-blue-500", label: "Contabilidad" },
  legal: { icon: Scale, color: "text-amber-600", label: "Legal" },
  cumplimiento: { icon: ShieldCheck, color: "text-emerald-600", label: "Cumplimiento / PLD" },
  pld_ft: { icon: ShieldCheck, color: "text-emerald-600", label: "PLD / FT" },
  general: { icon: Layers, color: "text-gray-500", label: "General" },
};

function getAreaMeta(area: string) {
  return areaConfig[area] || { icon: Layers, color: "text-gray-500", label: area };
}

interface ClientGroup {
  client_id: string;
  client_name: string;
  areas: { area: string; doc_count: number; chunk_count: number; last_chunk_at: string | null }[];
  totalDocs: number;
  totalChunks: number;
  lastActivity: string | null;
}

function groupByClient(rows: ClientKnowledgeStat[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>();
  for (const r of rows) {
    let g = map.get(r.client_id);
    if (!g) {
      g = { client_id: r.client_id, client_name: r.client_name, areas: [], totalDocs: 0, totalChunks: 0, lastActivity: null };
      map.set(r.client_id, g);
    }
    g.areas.push({ area: r.area, doc_count: r.doc_count, chunk_count: r.chunk_count, last_chunk_at: r.last_chunk_at });
    g.totalDocs += r.doc_count;
    g.totalChunks += r.chunk_count;
    if (r.last_chunk_at && (!g.lastActivity || r.last_chunk_at > g.lastActivity)) {
      g.lastActivity = r.last_chunk_at;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalChunks - a.totalChunks);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Sin actividad";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} día${days > 1 ? "s" : ""}`;
}

export function ClientsLearningTab() {
  const { data: stats, isLoading } = useClientKnowledgeStats();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [technical, setTechnical] = useState(() => readKnowledgeTechnicalMode());

  useEffect(() => {
    writeKnowledgeTechnicalMode(technical);
  }, [technical]);

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }

  const groups = groupByClient(stats || []);
  const maxChunks = Math.max(...groups.map((g) => g.totalChunks), 1);

  if (!groups.length) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No hay datos de clientes indexados todavía</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Indexa documentos desde Dropbox o sube archivos a proyectos para comenzar
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Code2 className="h-4 w-4 shrink-0" />
          <span>Mostrar detalle técnico (tipos crudos, IDs)</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="knowledge-tech-client" checked={technical} onCheckedChange={setTechnical} />
          <Label htmlFor="knowledge-tech-client" className="text-xs cursor-pointer">Modo técnico</Label>
        </div>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g, idx) => (
          <ClientCard
            key={g.client_id}
            group={g}
            maxChunks={maxChunks}
            isExpanded={expanded === g.client_id}
            onToggle={() => setExpanded(expanded === g.client_id ? null : g.client_id)}
            stagger={idx}
            technical={technical}
          />
        ))}
      </div>
    </div>
  );
}

function ClientCard({
  group,
  maxChunks,
  isExpanded,
  onToggle,
  stagger,
  technical,
}: {
  group: ClientGroup;
  maxChunks: number;
  isExpanded: boolean;
  onToggle: () => void;
  stagger: number;
  technical: boolean;
}) {
  const navigate = useNavigate();
  const { data: insights, isLoading: insightsLoading } = useKnowledgeInsights(isExpanded ? group.client_id : undefined);
  const { data: recentChunks, isLoading: chunksLoading } = useRecentChunksForClient(isExpanded ? group.client_id : undefined, 10);
  const { data: feedItems, isLoading: feedLoading } = useKnowledgeFeedForClient(isExpanded ? group.client_id : undefined, 6);

  const coverage = Math.min(100, Math.round((group.totalChunks / maxChunks) * 100));

  return (
    <Card
      className={cn(
        "card-hover animate-fade-in cursor-pointer transition-all",
        `stagger-${Math.min(stagger + 1, 8)}`,
        isExpanded && "col-span-1 sm:col-span-2 lg:col-span-3 ring-1 ring-primary/20",
      )}
      onClick={onToggle}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">{group.client_name}</span>
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${group.client_id}`); }}
              className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors"
              title="Ir al cliente"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="hidden sm:inline">Ver cliente</span>
            </button>
            <Badge
              variant="secondary"
              className="text-[10px] hidden sm:inline-flex max-w-[14rem] truncate"
              title={`${METRIC_LABELS.doc_count.definition} ${METRIC_LABELS.chunk_count.definition}`}
            >
              {group.totalDocs} {METRIC_LABELS.doc_count.short} · {group.totalChunks} {METRIC_LABELS.chunk_count.short}
            </Badge>
            <Badge variant="secondary" className="text-[10px] sm:hidden" title={METRIC_LABELS.chunk_count.definition}>
              {group.totalChunks} frag.
            </Badge>
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-3 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-muted-foreground">{RELATIVE_VOLUME_BAR_LABEL}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{coverage}%</span>
          </div>
          <Progress value={coverage} className="h-1.5" />
          <p className="text-[10px] text-muted-foreground leading-snug">{RELATIVE_VOLUME_BAR_HINT}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {group.areas.map((a) => {
            const meta = getAreaMeta(a.area);
            const Icon = meta.icon;
            return (
              <div
                key={a.area}
                className="flex items-center gap-1 text-[11px] text-muted-foreground bg-secondary/40 rounded-md px-2 py-0.5"
                title={`${meta.label}: ${METRIC_LABELS.doc_count.label} ${a.doc_count}, ${METRIC_LABELS.chunk_count.label} ${a.chunk_count}`}
              >
                <Icon className={cn("h-3 w-3", meta.color)} />
                <span>
                  {meta.label}: {a.doc_count} doc. · {a.chunk_count} frag.
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {timeAgo(group.lastActivity)}
        </div>

        {isExpanded && (
          <div className="mt-4 border-t pt-4 space-y-6" onClick={(e) => e.stopPropagation()} role="region" aria-label="Detalle del cliente">
            <section className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                Qué ha aprendido el sistema
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Resúmenes generados por los agentes de conocimiento a partir de tus documentos indexados.
              </p>
              {insightsLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-24 w-full rounded-lg" />
                </div>
              )}
              {!insightsLoading && (!insights || insights.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  Aún no hay resúmenes para este cliente. Ejecuta el integrador de conocimiento desde Agentes.
                </p>
              )}
              {!insightsLoading && insights && insights.length > 0 && (
                <div className="grid gap-3 max-h-[min(70vh,520px)] overflow-y-auto pr-1 sm:grid-cols-2">
                  {insights.map((ins) => (
                    <KnowledgeInsightCard key={ins.id} insight={ins} technical={technical} />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                Últimos fragmentos indexados
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Texto reciente que ya forma parte del índice buscable para este cliente.
              </p>
              {chunksLoading && <Skeleton className="h-20 w-full rounded-lg" />}
              {!chunksLoading && (!recentChunks || recentChunks.length === 0) && (
                <p className="text-xs text-muted-foreground">Sin fragmentos recientes con este cliente como contexto.</p>
              )}
              {!chunksLoading && recentChunks && recentChunks.length > 0 && (
                <ul className="space-y-2">
                  {recentChunks.map((ch) => {
                    const src = getSourceTypeCopy(ch.source_type);
                    return (
                      <li key={ch.id} className="rounded-md border border-border/40 bg-secondary/20 p-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-2 text-muted-foreground mb-1">
                          <span className="font-medium text-foreground">{src.label}</span>
                          <span className="text-[10px]">
                            {new Date(ch.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                          </span>
                        </div>
                        <p className="text-foreground/90 leading-relaxed">{truncateChunkText(ch.content, 280)}</p>
                        {technical && (
                          <p className="text-[9px] font-mono text-muted-foreground mt-1 break-all">{ch.id}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <Rss className="h-3.5 w-3.5 text-emerald-600" />
                Actividad del feed
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Eventos recientes del tablero de conocimiento vinculados a este cliente.
              </p>
              {feedLoading && <Skeleton className="h-16 w-full rounded-lg" />}
              {!feedLoading && (!feedItems || feedItems.length === 0) && (
                <p className="text-xs text-muted-foreground">Sin entradas de feed para este cliente.</p>
              )}
              {!feedLoading && feedItems && feedItems.length > 0 && (
                <ul className="space-y-2">
                  {feedItems.map((f) => (
                    <li key={f.id} className="rounded-md bg-secondary/25 px-3 py-2 text-[11px]">
                      <div className="font-medium text-foreground">{f.title}</div>
                      <div className="text-muted-foreground text-[10px] mt-0.5">
                        {formatFeedType(f.feed_type)} · {new Date(f.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                      {f.summary && <p className="mt-1 text-muted-foreground">{f.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
