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
        .select("*, clients(name, dropbox_folder_path, responsible_user_id)")
        .eq("id", projectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!projectId,
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Omit<Project, "id" | "created_at" | "organization_id">>) => {
      // If client_id is changing, auto-rename project to reflect new client
      if (updates.client_id) {
        const { data: currentProject } = await supabase
          .from("projects")
          .select("name, client_id, clients(name)")
          .eq("id", id)
          .single();

        if (currentProject) {
          const oldClientName = (currentProject as any).clients?.name;
          
          // Fetch new client name
          const { data: newClient } = await supabase
            .from("clients")
            .select("name")
            .eq("id", updates.client_id)
            .single();

          if (oldClientName && newClient?.name && oldClientName !== newClient.name) {
            // Replace old client name with new one in project name
            if (currentProject.name.includes(oldClientName)) {
              updates.name = currentProject.name.replace(oldClientName, newClient.name);
            }

            // Also rename related tasks
            const { data: projectTasks } = await supabase
              .from("tasks")
              .select("id, title")
              .eq("project_id", id);

            if (projectTasks) {
              for (const task of projectTasks) {
                if (task.title.includes(oldClientName)) {
                  await supabase
                    .from("tasks")
                    .update({ title: task.title.replace(oldClientName, newClient.name) })
                    .eq("id", task.id);
                }
              }
            }
          }
        }
      }

      const { error } = await supabase
        .from("projects")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["project", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Proyecto actualizado");
    },
    onError: (error: Error) => toast.error("Error al actualizar: " + error.message),
  });
}
