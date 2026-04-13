import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  useProjectKnowledgeStats,
  useKnowledgeInsights,
  useRecentChunksForProject,
  useKnowledgeFeedForProject,
  type ProjectKnowledgeStat,
} from "@/hooks/useKnowledge";
import { KnowledgeInsightCard } from "@/components/knowledge/KnowledgeInsightCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  FolderKanban, ChevronDown, ChevronRight, ExternalLink,
  FileText, Scale, ShieldCheck, Layers, Clock,
  Lightbulb, Rss, Code2,
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

const areaConfig: Record<string, { color: string; label: string; icon: typeof FileText }> = {
  contabilidad: { icon: FileText, color: "text-blue-500", label: "Contabilidad" },
  legal: { icon: Scale, color: "text-amber-600", label: "Legal" },
  cumplimiento: { icon: ShieldCheck, color: "text-emerald-600", label: "Cumplimiento" },
  pld_ft: { icon: ShieldCheck, color: "text-emerald-600", label: "PLD / FT" },
  softlanding: { icon: Layers, color: "text-violet-500", label: "Softlanding" },
  juicios: { icon: Scale, color: "text-red-500", label: "Juicios" },
  gestoria: { icon: Layers, color: "text-cyan-500", label: "Gestoría" },
  general: { icon: Layers, color: "text-gray-500", label: "General" },
};

function getAreaMeta(area: string) {
  return areaConfig[area] || { icon: Layers, color: "text-gray-500", label: area };
}

interface AreaGroup {
  area: string;
  projects: ProjectKnowledgeStat[];
  totalDocs: number;
  totalChunks: number;
}

function groupByArea(rows: ProjectKnowledgeStat[]): AreaGroup[] {
  const map = new Map<string, AreaGroup>();
  for (const r of rows) {
    let g = map.get(r.area);
    if (!g) {
      g = { area: r.area, projects: [], totalDocs: 0, totalChunks: 0 };
      map.set(r.area, g);
    }
    g.projects.push(r);
    g.totalDocs += r.doc_count;
    g.totalChunks += r.chunk_count;
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
  return `Hace ${days}d`;
}

export function ProjectsLearningTab() {
  const { data: stats, isLoading } = useProjectKnowledgeStats();
  const [expandedArea, setExpandedArea] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [technical, setTechnical] = useState(() => readKnowledgeTechnicalMode());

  useEffect(() => {
    writeKnowledgeTechnicalMode(technical);
  }, [technical]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  const areaGroups = groupByArea(stats || []);

  if (!areaGroups.length) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <FolderKanban className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No hay proyectos con documentos indexados</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Vincula documentos a proyectos para ver su progreso de aprendizaje
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxChunks = Math.max(...areaGroups.map((a) => a.totalChunks), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Code2 className="h-4 w-4 shrink-0" />
          <span>Mostrar detalle técnico (tipos crudos, IDs)</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="knowledge-tech-project" checked={technical} onCheckedChange={setTechnical} />
          <Label htmlFor="knowledge-tech-project" className="text-xs cursor-pointer">Modo técnico</Label>
        </div>
      </div>
      {areaGroups.map((ag, idx) => {
        const meta = getAreaMeta(ag.area);
        const Icon = meta.icon;
        const isOpen = expandedArea === ag.area;
        const areaCoverage = Math.min(100, Math.round((ag.totalChunks / maxChunks) * 100));

        return (
          <Card key={ag.area} className={`animate-fade-in stagger-${Math.min(idx + 1, 8)}`}>
            <CardHeader
              className="pb-2 cursor-pointer hover:bg-secondary/20 transition-colors rounded-t-xl"
              onClick={() => setExpandedArea(isOpen ? null : ag.area)}
            >
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2 min-w-0">
                  <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />
                  <span className="truncate">{meta.label}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {ag.projects.length} proyecto{ag.projects.length > 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-[10px] text-muted-foreground hidden sm:inline max-w-[12rem] truncate"
                    title={`${METRIC_LABELS.doc_count.definition} ${METRIC_LABELS.chunk_count.definition}`}
                  >
                    {ag.totalDocs} doc. · {ag.totalChunks} frag.
                  </span>
                  <span className="text-[10px] text-muted-foreground sm:hidden">{ag.totalChunks} frag.</span>
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
              </div>
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{RELATIVE_VOLUME_BAR_LABEL}</span>
                  <span className="tabular-nums">{areaCoverage}%</span>
                </div>
                <Progress value={areaCoverage} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground leading-snug">{RELATIVE_VOLUME_BAR_HINT}</p>
              </div>
            </CardHeader>

            {isOpen && (
              <CardContent className="pt-0 pb-3 space-y-2">
                {ag.projects.map((p) => (
                  <ProjectRow
                    key={p.project_id}
                    project={p}
                    isExpanded={expandedProject === p.project_id}
                    technical={technical}
                    onToggle={() => setExpandedProject(expandedProject === p.project_id ? null : p.project_id)}
                  />
                ))}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ProjectRow({
  project,
  isExpanded,
  onToggle,
  technical,
}: {
  project: ProjectKnowledgeStat;
  isExpanded: boolean;
  onToggle: () => void;
  technical: boolean;
}) {
  const navigate = useNavigate();
  const { data: insights, isLoading: insightsLoading } = useKnowledgeInsights(undefined, isExpanded ? project.project_id : undefined);
  const { data: recentChunks, isLoading: chunksLoading } = useRecentChunksForProject(isExpanded ? project.project_id : undefined, 10);
  const { data: feedItems, isLoading: feedLoading } = useKnowledgeFeedForProject(isExpanded ? project.project_id : undefined, 6);

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-all cursor-pointer",
        isExpanded ? "ring-1 ring-primary/20 bg-secondary/10" : "hover:bg-secondary/20",
      )}
      onClick={onToggle}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FolderKanban className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-xs font-medium truncate">{project.project_name}</span>
          {project.client_name && (
            <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">— {project.client_name}</span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-5 sm:ml-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigate(`/proyectos/${project.project_id}`); }}
            className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors"
            title="Ir al proyecto"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="hidden sm:inline">Ver</span>
          </button>
          <Badge variant="outline" className="text-[9px]" title={`${METRIC_LABELS.doc_count.label}: ${project.doc_count}; ${METRIC_LABELS.chunk_count.label}: ${project.chunk_count}`}>
            {project.doc_count} doc. · {project.chunk_count} frag.
          </Badge>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" /> {timeAgo(project.last_chunk_at)}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3 border-t pt-3 space-y-5" onClick={(e) => e.stopPropagation()} role="region" aria-label="Detalle del proyecto">
          <section className="space-y-2">
            <h4 className="text-xs font-semibold flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
              Qué ha aprendido el sistema
            </h4>
            {insightsLoading && (
              <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-20 w-full rounded-md" />
              </div>
            )}
            {!insightsLoading && (!insights || insights.length === 0) && (
              <p className="text-xs text-muted-foreground">Sin resúmenes generados para este proyecto.</p>
            )}
            {!insightsLoading && insights && insights.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 max-h-[min(60vh,480px)] overflow-y-auto pr-1">
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
            {chunksLoading && <Skeleton className="h-16 w-full rounded-md" />}
            {!chunksLoading && (!recentChunks || recentChunks.length === 0) && (
              <p className="text-xs text-muted-foreground">Sin fragmentos recientes ligados a este proyecto.</p>
            )}
            {!chunksLoading && recentChunks && recentChunks.length > 0 && (
              <ul className="space-y-2">
                {recentChunks.map((ch) => {
                  const src = getSourceTypeCopy(ch.source_type);
                  return (
                    <li key={ch.id} className="rounded-md border border-border/40 bg-secondary/20 p-2 text-[11px]">
                      <div className="flex flex-wrap gap-2 text-muted-foreground mb-1">
                        <span className="font-medium text-foreground">{src.label}</span>
                        <span className="text-[10px]">
                          {new Date(ch.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      </div>
                      <p className="text-foreground/90 leading-relaxed">{truncateChunkText(ch.content, 280)}</p>
                      {technical && <p className="text-[9px] font-mono text-muted-foreground mt-1 break-all">{ch.id}</p>}
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
            {feedLoading && <Skeleton className="h-14 w-full rounded-md" />}
            {!feedLoading && (!feedItems || feedItems.length === 0) && (
              <p className="text-xs text-muted-foreground">Sin entradas de feed para este proyecto.</p>
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
    </div>
  );
}
