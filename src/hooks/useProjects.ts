import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type Project = Tables<"projects">;

export function useProjects() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, clients(name, dropbox_folder_path)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Delete related records first to avoid FK constraints
      const { error: apError } = await supabase
        .from("accounting_periods")
        .delete()
        .eq("project_id", id);
      if (apError) throw apError;

      const { error: docError } = await supabase
        .from("documents")
        .delete()
        .eq("project_id", id);
      if (docError) throw docError;

      const { error: taskError } = await supabase
        .from("tasks")
        .delete()
        .eq("project_id", id);
      if (taskError) throw taskError;

      const { error: memberError } = await supabase
        .from("project_members")
        .delete()
        .eq("project_id", id);
      if (memberError) throw memberError;

      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Proyecto eliminado");
    },
    onError: (error: Error) => toast.error("Error al eliminar proyecto: " + error.message),
  });
}

export function useProjectDetail(projectId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, clients(name, dropbox_folder_path)")
        .eq("id", projectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });
}
