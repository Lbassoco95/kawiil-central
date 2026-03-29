import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AiArtifact {
  id: string;
  ai_project_id: string | null;
  conversation_id: string | null;
  user_id: string;
  organization_id: string;
  title: string;
  content: string;
  content_type: string;
  created_at: string;
  updated_at: string;
}

export function useAiArtifacts(aiProjectId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: artifacts, isLoading } = useQuery({
    queryKey: ["ai-artifacts", aiProjectId],
    queryFn: async () => {
      let query = (supabase as any)
        .from("ai_artifacts")
        .select("*")
        .eq("user_id", user!.id);

      if (aiProjectId) {
        query = query.eq("ai_project_id", aiProjectId);
      } else {
        query = query.is("ai_project_id", null);
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data as AiArtifact[];
    },
    enabled: !!user,
    refetchInterval: 5000,
  });

  const updateArtifact = useMutation({
    mutationFn: async ({ id, content, title }: { id: string; content: string; title?: string }) => {
      const updates: any = { content, updated_at: new Date().toISOString() };
      if (title) updates.title = title;
      const { error } = await (supabase as any)
        .from("ai_artifacts")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-artifacts", aiProjectId] }),
  });

  const deleteArtifact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("ai_artifacts")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-artifacts", aiProjectId] }),
  });

  return {
    artifacts: artifacts ?? [],
    isLoading,
    updateArtifact,
    deleteArtifact,
  };
}
