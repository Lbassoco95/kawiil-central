import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AiMemory {
  id: string;
  ai_project_id: string | null;
  user_id: string;
  organization_id: string;
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function useAiMemories(aiProjectId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: memories, isLoading } = useQuery({
    queryKey: ["ai-memories", aiProjectId],
    queryFn: async () => {
      let query = (supabase as any)
        .from("ai_project_memories")
        .select("*")
        .eq("user_id", user!.id);

      if (aiProjectId) {
        query = query.eq("ai_project_id", aiProjectId);
      } else {
        query = query.is("ai_project_id", null);
      }

      const { data, error } = await query.order("path");
      if (error) throw error;
      return data as AiMemory[];
    },
    enabled: !!user,
  });

  const updateMemory = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await (supabase as any)
        .from("ai_project_memories")
        .update({ content, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-memories", aiProjectId] }),
  });

  const deleteMemory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("ai_project_memories")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-memories", aiProjectId] }),
  });

  return {
    memories: memories ?? [],
    isLoading,
    updateMemory,
    deleteMemory,
  };
}
