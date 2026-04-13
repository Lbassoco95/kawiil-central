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
  taskChunks: number;
  projectChunks: number;
  documentChunks: number;
  lastSyncAt: string | null;
}

export interface DocumentChunkPreview {
  id: string;
  content: string;
  source_type: string;
  metadata: Record<string, unknown>;
  document_id: string | null;
  project_id: string | null;
  created_at: string;
}

const MAX_SOURCE_CHUNK_IDS = 24;

/** Fragmentos citados por un insight (solo cuando hay IDs en source_chunks). */
export function useInsightSourceChunks(chunkIds: string[] | null | undefined) {
  const orgId = useOrgId();
  const ids = useMemo(() => {
    if (!chunkIds?.length) return [] as string[];
    return [...new Set(chunkIds)].slice(0, MAX_SOURCE_CHUNK_IDS).sort();
  }, [chunkIds]);

  return useQuery({
    queryKey: ["insight-source-chunks", orgId, ids],
    enabled: !!orgId && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_chunks")
        .select("id, content, source_type, metadata, document_id, project_id, created_at")
        .in("id", ids);
      if (error) throw error;
      return (data || []) as DocumentChunkPreview[];
    },
  });
}

/** Últimos fragmentos indexados para un cliente (transparencia de indexación). */
export function useRecentChunksForClient(clientId: string | null | undefined, limit = 10) {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["recent-chunks-client", orgId, clientId, limit],
    enabled: !!orgId && !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_chunks")
        .select("id, content, source_type, metadata, document_id, project_id, created_at")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as DocumentChunkPreview[];
    },
  });
}

/** Actividad del feed de conocimiento filtrada por cliente. */
export function useKnowledgeFeedForClient(clientId: string | null | undefined, limit = 8) {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["knowledge-feed-client", orgId, clientId, limit],
    enabled: !!orgId && !!clientId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("knowledge_feed")
        .select("*")
        .eq("organization_id", orgId)
        .eq("related_client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as KnowledgeFeedItem[];
    },
  });
}

export function useKnowledgeFeedForProject(projectId: string | null | undefined, limit = 8) {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["knowledge-feed-project", orgId, projectId, limit],
    enabled: !!orgId && !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("knowledge_feed")
        .select("*")
        .eq("organization_id", orgId)
        .eq("related_project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as KnowledgeFeedItem[];
    },
  });
}

export function useRecentChunksForProject(projectId: string | null | undefined, limit = 10) {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["recent-chunks-project", orgId, projectId, limit],
    enabled: !!orgId && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_chunks")
        .select("id, content, source_type, metadata, document_id, project_id, created_at")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as DocumentChunkPreview[];
    },
  });
}

export function useLearningProgress() {
  const orgId = useOrgId();

  return useQuery({
    queryKey: ["learning-progress", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("learning_progress_stats", {
        p_org_id: orgId,
      });

      if (error) {
        console.error("learning_progress_stats RPC error:", error);
        throw error;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return {
          totalDocs: 0,
          totalChunks: 0,
          totalInsights: 0,
          totalFeedItems: 0,
          clientsWithChunks: 0,
          totalClients: 0,
          projectsWithChunks: 0,
          totalProjects: 0,
          taskChunks: 0,
          projectChunks: 0,
          documentChunks: 0,
          lastSyncAt: null,
        } as LearningProgress;
      }

      return {
        totalDocs: Number(row.total_docs) || 0,
        totalChunks: Number(row.total_chunks) || 0,
        totalInsights: Number(row.total_insights) || 0,
        totalFeedItems: Number(row.total_feed_items) || 0,
        clientsWithChunks: Number(row.clients_with_chunks) || 0,
        totalClients: Number(row.total_active_clients) || 0,
        projectsWithChunks: Number(row.projects_with_chunks) || 0,
        totalProjects: Number(row.total_active_projects) || 0,
        taskChunks: Number(row.task_chunks) || 0,
        projectChunks: Number(row.project_chunks) || 0,
        documentChunks: Number(row.document_chunks_count) || 0,
        lastSyncAt: row.last_sync_at || null,
      } as LearningProgress;
    },
  });
}
