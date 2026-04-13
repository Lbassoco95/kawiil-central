import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientKnowledgeStats, useProjectKnowledgeStats } from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database, FileText, MessageSquare, BookOpen, BrainCircuit,
  Sparkles, BarChart3, Building2, FolderKanban, Layers, ThumbsDown,
} from "lucide-react";
import { getSourceTypeCopy, TOTAL_CHUNKS_KPI, METRIC_LABELS, RELATIVE_VOLUME_BAR_LABEL } from "@/lib/knowledgeLabels";

export function StatsTab() {
  const { user } = useAuth();

  const { data: embeddingStats, isLoading: statsLoading } = useQuery({
    queryKey: ["embedding-stats"],
    queryFn: async () => {
      const orgRes = await supabase.rpc("get_user_org_id" as any, { _user_id: user!.id });
      const { data, error } = await supabase.rpc("embedding_stats" as any, { org_id: orgRes.data });
      if (error) throw error;
      return data as { source_type: string; chunk_count: number; earliest: string | null; latest: string | null }[];
    },
    enabled: !!user,
  });

  const { data: clientStats, isLoading: clientLoading } = useClientKnowledgeStats();
  const { data: projectStats, isLoading: projectLoading } = useProjectKnowledgeStats();

  const { data: learningStats, isLoading: learningLoading } = useQuery({
    queryKey: ["ai-learning-stats", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ai_learning_stats_for_org");
      if (error) throw error;
      return data as {
        feedback_down_by_category?: { category: string; n: number }[];
        user_memories_by_type?: { memory_type: string; n: number }[];
      } | null;
    },
    enabled: !!user,
  });

  const totalChunks = embeddingStats?.reduce((s, r) => s + (r.chunk_count || 0), 0) ?? 0;

  const sourceIcon = (type: string) => {
    const icons: Record<string, typeof FileText> = {
      document: FileText,
      extracted_data: Database,
      chat_message: MessageSquare,
      procedure: BookOpen,
      comunicado: BarChart3,
      memory: BrainCircuit,
      artifact: Sparkles,
    };
    const Icon = icons[type] || Database;
    return <Icon className="h-4 w-4 text-primary" />;
  };

  // Client coverage
  const clientCoverage = (() => {
    if (!clientStats?.length) return [];
    const map = new Map<string, { client_id: string; name: string; chunks: number }>();
    for (const r of clientStats) {
      const g = map.get(r.client_id) || { client_id: r.client_id, name: r.client_name, chunks: 0 };
      g.chunks += r.chunk_count;
      map.set(r.client_id, g);
    }
    return Array.from(map.values()).sort((a, b) => b.chunks - a.chunks);
  })();

  // Area coverage
  const areaCoverage = (() => {
    if (!projectStats?.length) return [];
    const map = new Map<string, number>();
    for (const r of projectStats) {
      map.set(r.area, (map.get(r.area) || 0) + r.chunk_count);
    }
    return Array.from(map.entries())
      .map(([area, chunks]) => ({ area, chunks }))
      .sort((a, b) => b.chunks - a.chunks);
  })();

  const maxClientChunks = Math.max(...clientCoverage.map((c) => c.chunks), 1);
  const maxAreaChunks = Math.max(...areaCoverage.map((a) => a.chunks), 1);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Global KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {statsLoading ? (
          <Skeleton className="col-span-full h-24 rounded-xl" />
        ) : (
          <>
            <Card className="stat-card">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <Database className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-foreground">{TOTAL_CHUNKS_KPI.title}</span>
                </div>
                <p className="text-2xl font-bold">{totalChunks.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">{TOTAL_CHUNKS_KPI.definition}</p>
                <p className="text-[9px] text-muted-foreground/70 mt-1 font-mono leading-tight">{TOTAL_CHUNKS_KPI.technical}</p>
              </CardContent>
            </Card>
            {embeddingStats?.map((s) => {
              const copy = getSourceTypeCopy(s.source_type);
              return (
                <Card key={s.source_type} className="stat-card">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2 mb-1">
                      {sourceIcon(s.source_type)}
                      <span className="text-xs font-medium text-foreground">{copy.label}</span>
                    </div>
                    <p className="text-2xl font-bold">{s.chunk_count.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">{copy.definition}</p>
                    {s.latest && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Último: {new Date(s.latest).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>

      {/* Feedback IA + memorias automáticas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ThumbsDown className="h-4 w-4 text-muted-foreground" /> Feedback negativo por categoría
            </CardTitle>
            <p className="text-[11px] text-muted-foreground font-normal">
              Pulgares abajo en respuestas de la IA, agrupados por motivo. Sirve para detectar temas a mejorar en plantillas o conocimiento.
            </p>
          </CardHeader>
          <CardContent>
            {learningLoading ? (
              <Skeleton className="h-20 rounded" />
            ) : !learningStats?.feedback_down_by_category?.length ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sin datos aún</p>
            ) : (
              <div className="space-y-2">
                {learningStats.feedback_down_by_category.map((r) => (
                  <div key={r.category} className="flex justify-between text-xs">
                    <span className="truncate max-w-[70%]">{r.category.replace(/_/g, " ")}</span>
                    <span className="font-medium">{r.n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" /> Memorias automáticas por tipo
            </CardTitle>
            <p className="text-[11px] text-muted-foreground font-normal">
              Hechos o preferencias que el sistema extrajo de conversaciones y guardó para personalizar respuestas futuras.
            </p>
          </CardHeader>
          <CardContent>
            {learningLoading ? (
              <Skeleton className="h-20 rounded" />
            ) : !learningStats?.user_memories_by_type?.length ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sin memorias extraídas aún</p>
            ) : (
              <div className="space-y-2">
                {learningStats.user_memories_by_type.map((r) => (
                  <div key={r.memory_type} className="flex justify-between text-xs">
                    <span className="capitalize">{r.memory_type}</span>
                    <span className="font-medium">{r.n}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Client coverage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Cobertura por cliente
          </CardTitle>
          <p className="text-[11px] text-muted-foreground font-normal">
            {RELATIVE_VOLUME_BAR_LABEL}: cada barra compara el cliente con el que tiene más {METRIC_LABELS.chunk_count.short} en la organización.
          </p>
        </CardHeader>
        <CardContent>
          {clientLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 rounded" />
              ))}
            </div>
          ) : !clientCoverage.length ? (
            <p className="text-xs text-muted-foreground text-center py-6">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {clientCoverage.slice(0, 15).map((c, i) => (
                <div key={c.client_id || i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium truncate max-w-[120px] sm:max-w-[200px]">{c.name}</span>
                    <span className="text-muted-foreground">{c.chunks.toLocaleString()} frag.</span>
                  </div>
                  <Progress value={Math.round((c.chunks / maxClientChunks) * 100)} className="h-1.5" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Area coverage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4" /> Cobertura por área
          </CardTitle>
          <p className="text-[11px] text-muted-foreground font-normal">
            Volumen de {METRIC_LABELS.chunk_count.label.toLowerCase()} agrupado por área de proyecto (misma lógica de barras relativas).
          </p>
        </CardHeader>
        <CardContent>
          {projectLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 rounded" />
              ))}
            </div>
          ) : !areaCoverage.length ? (
            <p className="text-xs text-muted-foreground text-center py-6">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {areaCoverage.map((a) => (
                <div key={a.area} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium capitalize">{a.area}</span>
                    <span className="text-muted-foreground">{a.chunks.toLocaleString()} frag.</span>
                  </div>
                  <Progress value={Math.round((a.chunks / maxAreaChunks) * 100)} className="h-1.5" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Project summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderKanban className="h-4 w-4" /> Resumen de proyectos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projectLoading ? (
            <Skeleton className="h-24 rounded" />
          ) : !projectStats?.length ? (
            <p className="text-xs text-muted-foreground text-center py-6">Sin datos de proyectos</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{new Set(projectStats.map((p) => p.project_id)).size}</p>
                <p className="text-xs text-muted-foreground">Proyectos activos</p>
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {projectStats.reduce((s, p) => s + p.doc_count, 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Documentos vinculados</p>
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {projectStats.reduce((s, p) => s + p.chunk_count, 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">{METRIC_LABELS.chunk_count.label} (proyectos)</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
