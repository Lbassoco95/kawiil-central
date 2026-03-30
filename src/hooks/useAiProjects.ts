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
      const { data, error } = await supabase.rpc("get_my_ai_projects" as any);
      if (error) throw error;
      return (data ?? []) as AiProject[];
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

  const leaveAiProject = useMutation({
    mutationFn: async (projectId: string) => {
      const { data: proj } = await (supabase as any)
        .from("ai_projects")
        .select("user_id")
        .eq("id", projectId)
        .single();
      if (proj?.user_id === user!.id) {
        throw new Error("El dueño debe archivar el proyecto; no puede abandonarlo así.");
      }
      const { data: rows } = await (supabase as any)
        .from("ai_project_members")
        .select("id")
        .eq("ai_project_id", projectId)
        .eq("user_id", user!.id);
      const row = rows?.[0];
      if (!row) return;
      const { error } = await (supabase as any).from("ai_project_members").delete().eq("id", row.id);
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
    leaveAiProject,
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

export interface AiProjectMemberRow {
  id: string;
  ai_project_id: string;
  user_id: string;
  role: string;
  invited_by: string | null;
  created_at: string;
}

export function useAiProjectMembers(projectId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: members, isLoading } = useQuery({
    queryKey: ["ai-project-members", projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_project_members")
        .select("id, ai_project_id, user_id, role, invited_by, created_at")
        .eq("ai_project_id", projectId!);
      if (error) throw error;
      return data as AiProjectMemberRow[];
    },
    enabled: !!projectId && !!user,
  });

  const addMember = useMutation({
    mutationFn: async ({ userId, role = "editor" }: { userId: string; role?: string }) => {
      const { error } = await (supabase as any).from("ai_project_members").insert({
        ai_project_id: projectId!,
        user_id: userId,
        role,
        invited_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-project-members", projectId] }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberRowId: string) => {
      const { error } = await (supabase as any).from("ai_project_members").delete().eq("id", memberRowId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-project-members", projectId] }),
  });

  return { members: members ?? [], isLoading, addMember, removeMember };
}
