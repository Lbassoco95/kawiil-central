import { useState } from "react";
import { useProjectKnowledgeStats, useKnowledgeInsights, type ProjectKnowledgeStat } from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderKanban, ChevronDown, ChevronRight, Lightbulb,
  FileText, Scale, ShieldCheck, Layers, Clock, AlertTriangle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

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
      {areaGroups.map((ag, idx) => {
        const meta = getAreaMeta(ag.area);
        const Icon = meta.icon;
        const isOpen = expandedArea === ag.area;

        return (
          <Card key={ag.area} className={`animate-fade-in stagger-${Math.min(idx + 1, 8)}`}>
            <CardHeader
              className="pb-2 cursor-pointer hover:bg-secondary/20 transition-colors rounded-t-xl"
              onClick={() => setExpandedArea(isOpen ? null : ag.area)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${meta.color}`} />
                  {meta.label}
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {ag.projects.length} proyecto{ag.projects.length > 1 ? "s" : ""}
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{ag.totalDocs} docs · {ag.totalChunks} chunks</span>
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
              </div>
              <Progress value={Math.min(100, Math.round((ag.totalChunks / maxChunks) * 100))} className="h-1.5 mt-2" />
            </CardHeader>

            {isOpen && (
              <CardContent className="pt-0 pb-3 space-y-2">
                {ag.projects.map((p) => (
                  <ProjectRow
                    key={p.project_id}
                    project={p}
                    isExpanded={expandedProject === p.project_id}
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
}: {
  project: ProjectKnowledgeStat;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { data: insights } = useKnowledgeInsights(undefined, isExpanded ? project.project_id : undefined);

  return (
    <div
      className={`rounded-lg border p-3 transition-all cursor-pointer ${isExpanded ? "ring-1 ring-primary/20 bg-secondary/10" : "hover:bg-secondary/20"}`}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">{project.project_name}</span>
          {project.client_name && (
            <span className="text-[10px] text-muted-foreground">— {project.client_name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px]">
            {project.doc_count}d / {project.chunk_count}c
          </Badge>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" /> {timeAgo(project.last_chunk_at)}
          </span>
        </div>
      </div>

      {isExpanded && insights && (
        <div className="mt-3 border-t pt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          {insights.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin insights generados para este proyecto.</p>
          ) : (
            insights.slice(0, 3).map((ins) => (
              <div key={ins.id} className="bg-secondary/30 rounded-md p-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  {ins.insight_type === "pattern" ? (
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                  ) : (
                    <Lightbulb className="h-3 w-3 text-primary" />
                  )}
                  <span className="font-medium">{ins.title}</span>
                </div>
                <div className="prose prose-xs dark:prose-invert max-w-none text-xs line-clamp-3">
                  <ReactMarkdown>{ins.content}</ReactMarkdown>
                </div>
                {ins.metadata?.gaps?.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ins.metadata.gaps.map((g: string, i: number) => (
                      <Badge key={i} variant="destructive" className="text-[9px]">{g}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
