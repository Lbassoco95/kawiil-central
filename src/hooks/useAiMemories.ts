import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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

      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) throw error;
      return data as AiMemory[];
    },
    enabled: !!user,
  });

  const createMemory = useMutation({
    mutationFn: async (input: { path: string; content: string }) => {
      const orgRes = await supabase.rpc("get_user_org_id" as any, { _user_id: user!.id });
      const { data, error } = await (supabase as any)
        .from("ai_project_memories")
        .insert({
          ai_project_id: aiProjectId,
          user_id: user!.id,
          organization_id: orgRes.data,
          path: input.path,
          content: input.content,
        })
        .select()
        .single();
      if (error) throw error;
      return data as AiMemory;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-memories", aiProjectId] }),
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
    createMemory,
    updateMemory,
    deleteMemory,
  };
}
