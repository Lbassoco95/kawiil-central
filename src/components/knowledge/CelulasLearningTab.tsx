import { useState } from "react";
import { useCelulaKnowledgeStats, useKnowledgeInsights, type CelulaKnowledgeStat } from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, ChevronDown, ChevronRight, Lightbulb,
  FileText, Scale, ShieldCheck, Layers, Clock,
  FolderKanban, Building2, Gavel, Globe, BookCheck,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const slugIcons: Record<string, typeof FileText> = {
  contabilidad: FileText,
  legal: Scale,
  pld_ft: ShieldCheck,
  cumplimiento: ShieldCheck,
  juicios: Gavel,
  softlanding: Globe,
  gestoria: BookCheck,
};

function getSlugIcon(slug: string) {
  return slugIcons[slug] || Layers;
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

export function CelulasLearningTab() {
  const { data: stats, isLoading } = useCelulaKnowledgeStats();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }

  const celulas = (stats || []).filter((c) => c.doc_count > 0 || c.chunk_count > 0 || c.project_count > 0);
  const emptyCelulas = (stats || []).filter((c) => c.doc_count === 0 && c.chunk_count === 0 && c.project_count === 0);
  const maxChunks = Math.max(...celulas.map((c) => c.chunk_count), 1);

  if (!stats?.length) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No hay células configuradas</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Configura células en Administración para ver el conocimiento agrupado por práctica
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active celulas with data */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {celulas.map((cel, idx) => (
          <CelulaCard
            key={cel.celula_id}
            celula={cel}
            maxChunks={maxChunks}
            isExpanded={expanded === cel.celula_id}
            onToggle={() => setExpanded(expanded === cel.celula_id ? null : cel.celula_id)}
            stagger={idx}
          />
        ))}
      </div>

      {/* Empty celulas */}
      {emptyCelulas.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Células sin conocimiento indexado:</p>
          <div className="flex flex-wrap gap-2">
            {emptyCelulas.map((cel) => {
              const Icon = getSlugIcon(cel.celula_slug);
              return (
                <Badge key={cel.celula_id} variant="outline" className="text-xs gap-1.5 py-1">
                  <Icon className="h-3 w-3" />
                  {cel.celula_name}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CelulaCard({
  celula,
  maxChunks,
  isExpanded,
  onToggle,
  stagger,
}: {
  celula: CelulaKnowledgeStat;
  maxChunks: number;
  isExpanded: boolean;
  onToggle: () => void;
  stagger: number;
}) {
  const { data: insights } = useKnowledgeInsights(
    undefined,
    undefined,
  );

  const filteredInsights = isExpanded
    ? (insights || []).filter((i) => i.area === celula.celula_slug)
    : [];

  const coverage = Math.min(100, Math.round((celula.chunk_count / maxChunks) * 100));
  const Icon = getSlugIcon(celula.celula_slug);
  const borderColor = celula.celula_color || "#6366f1";

  return (
    <Card
      className={`card-hover animate-fade-in stagger-${Math.min(stagger + 1, 8)} cursor-pointer transition-all ${isExpanded ? "sm:col-span-2 lg:col-span-3 ring-1 ring-primary/20" : ""}`}
      style={{ borderLeftWidth: 4, borderLeftColor: borderColor }}
      onClick={onToggle}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4" style={{ color: borderColor }} />
            {celula.celula_name}
          </CardTitle>
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </CardHeader>

      <CardContent className="pb-3 space-y-3">
        <Progress value={coverage} className="h-1.5" />

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileText className="h-3 w-3 text-blue-500" />
            <span>{celula.doc_count} documentos</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Layers className="h-3 w-3 text-purple-500" />
            <span>{celula.chunk_count} chunks</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FolderKanban className="h-3 w-3 text-emerald-500" />
            <span>{celula.project_count} proyectos</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Building2 className="h-3 w-3 text-amber-500" />
            <span>{celula.client_count} clientes</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {timeAgo(celula.last_chunk_at)}
        </div>

        {isExpanded && (
          <div className="mt-4 border-t pt-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-xs font-semibold flex items-center gap-1">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Insights de {celula.celula_name}
            </h4>
            {filteredInsights.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No hay insights para esta célula. Ejecuta el Integrador para generar análisis.
              </p>
            ) : (
              filteredInsights.slice(0, 5).map((ins) => (
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
