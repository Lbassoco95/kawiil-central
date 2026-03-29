import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Shared hook: resolve the user's organization_id from profiles table
function useOrgId() {
  const { user } = useAuth();
  const { data: orgId } = useQuery({
    queryKey: ["my-org-id", user?.id],
    enabled: !!user,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (error || !data) return null;
      return data.organization_id as string;
    },
  });
  return orgId ?? null;
}

// ── Types ──

export interface KnowledgeSyncLog {
  id: string;
  organization_id: string;
  agent: "archivista" | "integrador" | "nutritor";
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  stats: Record<string, any>;
  error_message: string | null;
}

export interface KnowledgeInsight {
  id: string;
  organization_id: string;
  client_id: string | null;
  project_id: string | null;
  area: string | null;
  insight_type: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  source_chunks: string[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFeedItem {
  id: string;
  organization_id: string;
  feed_type: string;
  title: string;
  summary: string | null;
  detail: string | null;
  related_client_id: string | null;
  related_project_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ClientKnowledgeStat {
  client_id: string;
  client_name: string;
  area: string;
  doc_count: number;
  chunk_count: number;
  last_chunk_at: string | null;
}

export interface ProjectKnowledgeStat {
  project_id: string;
  project_name: string;
  client_name: string | null;
  area: string;
  doc_count: number;
  chunk_count: number;
  last_chunk_at: string | null;
}

export interface CelulaKnowledgeStat {
  celula_id: string;
  celula_name: string;
  celula_slug: string;
  celula_color: string | null;
  doc_count: number;
  chunk_count: number;
  project_count: number;
  client_count: number;
  last_chunk_at: string | null;
}

// ── Feed ──

export function useKnowledgeFeed() {
  const orgId = useOrgId();
  const qc = useQueryClient();

  const { data: feed = [], isLoading } = useQuery({
    queryKey: ["knowledge-feed", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("knowledge_feed")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as KnowledgeFeedItem[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any)
        .from("knowledge_feed")
        .update({ is_read: true })
        .eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-feed"] }),
  });

  return { feed, isLoading, markRead };
}

// ── Insights ──

export function useKnowledgeInsights(clientId?: string | null, projectId?: string | null) {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["knowledge-insights", orgId, clientId, projectId],
    enabled: !!orgId,
    queryFn: async () => {
      let query = (supabase as any)
        .from("knowledge_insights")
        .select("*")
        .eq("organization_id", orgId)
        .order("updated_at", { ascending: false });

      if (clientId) query = query.eq("client_id", clientId);
      if (projectId) query = query.eq("project_id", projectId);

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data as KnowledgeInsight[];
    },
  });
}

// ── Sync Logs (with conditional polling) ──

export function useKnowledgeSyncLogs() {
  const orgId = useOrgId();

  const query = useQuery({
    queryKey: ["knowledge-sync-logs", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("knowledge_sync_logs")
        .select("*")
        .eq("organization_id", orgId)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as KnowledgeSyncLog[];
    },
    refetchInterval: (query) => {
      const logs = query.state.data as KnowledgeSyncLog[] | undefined;
      const hasRunning = logs?.some((l) => l.status === "running");
      return hasRunning ? 5000 : false;
    },
  });

  return query;
}

// ── Running Agents (derived from logs) ──

export function useRunningAgents() {
  const { data: logs } = useKnowledgeSyncLogs();

  return useMemo(() => {
    if (!logs) return { running: [] as string[], isAnyRunning: false };
    const running = logs
      .filter((l) => l.status === "running")
      .map((l) => l.agent);
    return { running, isAnyRunning: running.length > 0 };
  }, [logs]);
}

// ── Run Sync ──

export function useRunKnowledgeSync() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params?: { agent?: string; client_id?: string }) => {
      const resp = await supabase.functions.invoke("knowledge-sync", {
        body: params || {},
      });
      if (resp.error) throw new Error(resp.error.message || "Error en Edge Function");
      if (resp.data?.error) throw new Error(resp.data.error);
      return resp.data;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["knowledge-sync-logs"] });
      qc.invalidateQueries({ queryKey: ["knowledge-feed"] });
      qc.invalidateQueries({ queryKey: ["knowledge-insights"] });
      qc.invalidateQueries({ queryKey: ["client-knowledge-stats"] });
      qc.invalidateQueries({ queryKey: ["project-knowledge-stats"] });
      qc.invalidateQueries({ queryKey: ["celula-knowledge-stats"] });
      qc.invalidateQueries({ queryKey: ["user-notifications"] });
      qc.invalidateQueries({ queryKey: ["unread-notifications-count"] });
    },
  });
}

// ── Client Knowledge Stats (RPC) ──

export function useClientKnowledgeStats() {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["client-knowledge-stats", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("client_knowledge_stats", {
        p_org_id: orgId,
      });
      if (error) throw error;
      return data as ClientKnowledgeStat[];
    },
  });
}

// ── Project Knowledge Stats (RPC) ──

export function useProjectKnowledgeStats() {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["project-knowledge-stats", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("project_knowledge_stats", {
        p_org_id: orgId,
      });
      if (error) throw error;
      return data as ProjectKnowledgeStat[];
    },
  });
}

// ── Celula Knowledge Stats (RPC) ──

export function useCelulaKnowledgeStats() {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["celula-knowledge-stats", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("celula_knowledge_stats", {
        p_org_id: orgId,
      });
      if (error) throw error;
      return data as CelulaKnowledgeStat[];
    },
  });
}

// ── Learning Progress Summary ──

export interface LearningProgress {
  totalDocs: number;
  totalChunks: number;
  totalInsights: number;
  totalFeedItems: number;
  clientsWithChunks: number;
  totalClients: number;
  projectsWithChunks: number;
  totalProjects: number;
  lastSyncAt: string | null;
}

export function useLearningProgress() {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["learning-progress", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [docsRes, chunksRes, insightsRes, feedRes, clientsRes, projectsRes, logsRes] = await Promise.all([
        (supabase as any).from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        (supabase as any).from("document_chunks").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        (supabase as any).from("knowledge_insights").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        (supabase as any).from("knowledge_feed").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        (supabase as any).from("clients").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "activo"),
        (supabase as any).from("projects").select("id", { count: "exact", head: true }).eq("organization_id", orgId).in("status", ["activo", "pausado"]),
        (supabase as any).from("knowledge_sync_logs").select("completed_at").eq("organization_id", orgId).eq("status", "completed").order("completed_at", { ascending: false }).limit(1),
      ]);

      const clientsWithChunksRes = await (supabase as any)
        .from("document_chunks")
        .select("client_id")
        .eq("organization_id", orgId)
        .not("client_id", "is", null);

      const projectsWithChunksRes = await (supabase as any)
        .from("document_chunks")
        .select("project_id")
        .eq("organization_id", orgId)
        .not("project_id", "is", null);

      const uniqueClients = new Set((clientsWithChunksRes.data || []).map((r: any) => r.client_id));
      const uniqueProjects = new Set((projectsWithChunksRes.data || []).map((r: any) => r.project_id));

      return {
        totalDocs: docsRes.count ?? 0,
        totalChunks: chunksRes.count ?? 0,
        totalInsights: insightsRes.count ?? 0,
        totalFeedItems: feedRes.count ?? 0,
        clientsWithChunks: uniqueClients.size,
        totalClients: clientsRes.count ?? 0,
        totalProjects: projectsRes.count ?? 0,
        projectsWithChunks: uniqueProjects.size,
        lastSyncAt: logsRes.data?.[0]?.completed_at || null,
      } as LearningProgress;
    },
  });
}
