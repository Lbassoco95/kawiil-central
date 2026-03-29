import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClientKnowledgeStats, useProjectKnowledgeStats } from "@/hooks/useKnowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database, FileText, MessageSquare, BookOpen, BrainCircuit,
  Sparkles, BarChart3, Building2, FolderKanban, Layers,
} from "lucide-react";

export function StatsTab() {
  const { user } = useAuth();

  const { data: embeddingStats, isLoading: statsLoading } = useQuery({
    queryKey: ["embedding-stats"],
    queryFn: async () => {
      const orgRes = await supabase.rpc("get_user_org_id" as any, { _user_id: user!.id });
      const { data, error } = await supabase.rpc("embedding_stats" as any, { org_id: orgRes.data });
      if (error) throw error;
      return data as { source_type: string; chunk_count: number; avg_tokens: number }[];
    },
    enabled: !!user,
  });

  const { data: clientStats, isLoading: clientLoading } = useClientKnowledgeStats();
  const { data: projectStats, isLoading: projectLoading } = useProjectKnowledgeStats();

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

  const sourceLabel = (type: string) => {
    const labels: Record<string, string> = {
      document: "Documentos",
      extracted_data: "Datos extraídos",
      chat_message: "Conversaciones",
      procedure: "Procedimientos",
      comunicado: "Comunicados",
      memory: "Memorias IA",
      artifact: "Artifacts",
    };
    return labels[type] || type;
  };

  // Client coverage
  const clientCoverage = (() => {
    if (!clientStats?.length) return [];
    const map = new Map<string, { name: string; chunks: number }>();
    for (const r of clientStats) {
      const g = map.get(r.client_id) || { name: r.client_name, chunks: 0 };
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
                  <span className="text-xs text-muted-foreground">Total chunks</span>
                </div>
                <p className="text-2xl font-bold">{totalChunks.toLocaleString()}</p>
              </CardContent>
            </Card>
            {embeddingStats?.map((s) => (
              <Card key={s.source_type} className="stat-card">
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    {sourceIcon(s.source_type)}
                    <span className="text-xs text-muted-foreground">{sourceLabel(s.source_type)}</span>
                  </div>
                  <p className="text-2xl font-bold">{s.chunk_count.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">~{Math.round(s.avg_tokens)} tokens/chunk</p>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>

      {/* Client coverage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Cobertura por cliente
          </CardTitle>
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
              {clientCoverage.slice(0, 15).map((c) => (
                <div key={c.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium truncate max-w-[120px] sm:max-w-[200px]">{c.name}</span>
                    <span className="text-muted-foreground">{c.chunks.toLocaleString()} chunks</span>
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
                    <span className="text-muted-foreground">{a.chunks.toLocaleString()} chunks</span>
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
                <p className="text-xs text-muted-foreground">Chunks de proyectos</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
