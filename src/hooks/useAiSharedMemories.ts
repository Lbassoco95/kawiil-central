import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AiSharedMemory {
  id: string;
  ai_project_id: string;
  organization_id: string;
  path: string;
  content: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useAiSharedMemories(aiProjectId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: memories, isLoading } = useQuery({
    queryKey: ["ai-shared-memories", aiProjectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_project_shared_memories")
        .select("*")
        .eq("ai_project_id", aiProjectId!)
        .order("path");
      if (error) throw error;
      return data as AiSharedMemory[];
    },
    enabled: !!user && !!aiProjectId,
  });

  const deleteMemory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("ai_project_shared_memories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-shared-memories", aiProjectId] }),
  });

  return {
    sharedMemories: memories ?? [],
    isLoading,
    deleteMemory,
  };
}
