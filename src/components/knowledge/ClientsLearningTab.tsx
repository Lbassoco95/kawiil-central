import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClientKnowledgeStats, useKnowledgeInsights, type ClientKnowledgeStat } from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, FileText, Scale, ShieldCheck, BookOpen, ExternalLink,
  ChevronDown, ChevronRight, Layers, Clock, Lightbulb,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

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
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g, idx) => (
        <ClientCard
          key={g.client_id}
          group={g}
          maxChunks={maxChunks}
          isExpanded={expanded === g.client_id}
          onToggle={() => setExpanded(expanded === g.client_id ? null : g.client_id)}
          stagger={idx}
        />
      ))}
    </div>
  );
}

function ClientCard({
  group,
  maxChunks,
  isExpanded,
  onToggle,
  stagger,
}: {
  group: ClientGroup;
  maxChunks: number;
  isExpanded: boolean;
  onToggle: () => void;
  stagger: number;
}) {
  const navigate = useNavigate();
  const { data: insights } = useKnowledgeInsights(isExpanded ? group.client_id : undefined);
  const coverage = Math.min(100, Math.round((group.totalChunks / maxChunks) * 100));

  return (
    <Card
      className={`card-hover animate-fade-in stagger-${Math.min(stagger + 1, 8)} cursor-pointer transition-all ${isExpanded ? "col-span-1 sm:col-span-2 lg:col-span-3 ring-1 ring-primary/20" : ""}`}
      onClick={onToggle}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            {group.client_name}
          </CardTitle>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${group.client_id}`); }}
              className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors"
              title="Ir al cliente"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="hidden sm:inline">Ver cliente</span>
            </button>
            <Badge variant="secondary" className="text-[10px] hidden sm:inline-flex">
              {group.totalDocs} docs · {group.totalChunks} chunks
            </Badge>
            <Badge variant="secondary" className="text-[10px] sm:hidden">
              {group.totalChunks}c
            </Badge>
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-3 space-y-3">
        <Progress value={coverage} className="h-1.5" />

        <div className="flex flex-wrap gap-2">
          {group.areas.map((a) => {
            const meta = getAreaMeta(a.area);
            const Icon = meta.icon;
            return (
              <div key={a.area} className="flex items-center gap-1 text-[11px] text-muted-foreground bg-secondary/40 rounded-md px-2 py-0.5">
                <Icon className={`h-3 w-3 ${meta.color}`} />
                <span>{meta.label}: {a.doc_count}d / {a.chunk_count}c</span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {timeAgo(group.lastActivity)}
        </div>

        {isExpanded && insights && (
          <div className="mt-4 border-t pt-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-xs font-semibold flex items-center gap-1">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Insights del cliente
            </h4>
            {insights.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aún no se han generado insights. Ejecuta el Integrador.</p>
            ) : (
              insights.slice(0, 5).map((ins) => (
                <div key={ins.id} className="bg-secondary/30 rounded-lg p-3 text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[9px]">{ins.insight_type}</Badge>
                    <span className="font-medium">{ins.title}</span>
                  </div>
                  <div className="prose prose-xs dark:prose-invert max-w-none text-xs line-clamp-4">
                    <ReactMarkdown>{ins.content}</ReactMarkdown>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
