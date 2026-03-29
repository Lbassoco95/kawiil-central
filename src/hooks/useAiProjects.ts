import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AiProject {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  client_id: string | null;
  project_id: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiProjectDocument {
  id: string;
  ai_project_id: string;
  document_id: string | null;
  dropbox_path: string | null;
  name: string;
  source: string;
  created_at: string;
}

export function useAiProjects() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: projects, isLoading } = useQuery({
    queryKey: ["ai-projects"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_projects")
        .select("*")
        .eq("user_id", user!.id)
        .eq("is_archived", false)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as AiProject[];
    },
    enabled: !!user,
  });

  const createProject = useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      instructions?: string;
      client_id?: string;
      project_id?: string;
    }) => {
      const orgRes = await supabase.rpc("get_user_org_id" as any, { _user_id: user!.id });
      const { data, error } = await (supabase as any)
        .from("ai_projects")
        .insert({
          organization_id: orgRes.data,
          user_id: user!.id,
          ...input,
        })
        .select()
        .single();
      if (error) throw error;
      return data as AiProject;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-projects"] }),
  });

  const updateProject = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AiProject> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from("ai_projects")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AiProject;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-projects"] }),
  });

  const archiveProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("ai_projects")
        .update({ is_archived: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-projects"] }),
  });

  return {
    projects: projects ?? [],
    isLoading,
    createProject,
    updateProject,
    archiveProject,
  };
}

export function useAiProjectDocuments(projectId: string | null) {
  const qc = useQueryClient();

  const { data: documents, isLoading } = useQuery({
    queryKey: ["ai-project-documents", projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_project_documents")
        .select("*")
        .eq("ai_project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AiProjectDocument[];
    },
    enabled: !!projectId,
  });

  const addDocument = useMutation({
    mutationFn: async (input: {
      ai_project_id: string;
      document_id?: string;
      dropbox_path?: string;
      name: string;
      source?: string;
    }) => {
      const { data, error } = await (supabase as any)
        .from("ai_project_documents")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as AiProjectDocument;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["ai-project-documents", projectId] }),
  });

  const removeDocument = useMutation({
    mutationFn: async (docId: string) => {
      const { error } = await (supabase as any)
        .from("ai_project_documents")
        .delete()
        .eq("id", docId);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["ai-project-documents", projectId] }),
  });

  return {
    documents: documents ?? [],
    isLoading,
    addDocument,
    removeDocument,
  };
}
