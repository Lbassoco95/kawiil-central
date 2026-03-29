import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  const { profile } = useAuth();
  const qc = useQueryClient();
  const orgId = profile?.organization_id;

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
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

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
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  const query = useQuery({
    queryKey: ["knowledge-sync-logs", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("knowledge_sync_logs")
        .select("*")
        .eq("organization_id", orgId)
        .order("started_at", { ascending: false })
        .limit(20);
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
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

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
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

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
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

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
