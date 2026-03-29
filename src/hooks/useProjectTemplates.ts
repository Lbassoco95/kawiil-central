import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ProjectTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  area: string | null;
  phases: any[];
  suggested_tasks: any[];
  is_ai_generated: boolean;
  created_by: string | null;
  created_at: string;
}

export function useProjectTemplates(area?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["project-templates", area],
    queryFn: async () => {
      let q = supabase.from("project_templates" as any).select("*").order("name");
      if (area) q = q.eq("area", area);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ProjectTemplate[];
    },
    enabled: !!user,
  });
}

export function useCreateProjectTemplate() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (tpl: {
      name: string;
      description?: string;
      area?: string;
      phases?: any[];
      suggested_tasks?: any[];
      is_ai_generated?: boolean;
    }) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { data, error } = await supabase
        .from("project_templates" as any)
        .insert({
          name: tpl.name,
          description: tpl.description || null,
          area: tpl.area || null,
          phases: tpl.phases || [],
          suggested_tasks: tpl.suggested_tasks || [],
          is_ai_generated: tpl.is_ai_generated || false,
          organization_id: orgId!,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ProjectTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-templates"] });
      toast.success("Plantilla guardada");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });
}

export function useDeleteProjectTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_templates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-templates"] });
      toast.success("Plantilla eliminada");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });
}
