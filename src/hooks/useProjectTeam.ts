import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ProjectTeamRole = "lead" | "senior" | "revision" | "junior" | "colaborador";

export const PROJECT_TEAM_ROLE_LABELS: Record<ProjectTeamRole, string> = {
  lead: "Lead",
  senior: "Senior",
  revision: "Revisión",
  junior: "Junior",
  colaborador: "Colaborador",
};

const ROLE_ORDER: Record<ProjectTeamRole, number> = {
  lead: 0,
  senior: 1,
  revision: 2,
  junior: 3,
  colaborador: 4,
};

export interface ProjectTeamMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectTeamRole;
  created_at: string;
  profile: {
    user_id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  } | null;
}

export function useProjectTeam(projectId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["project-team", projectId],
    enabled: !!user && !!projectId,
    queryFn: async (): Promise<ProjectTeamMember[]> => {
      const { data, error } = await supabase
        .from("project_team")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        project_id: string;
        user_id: string;
        role: ProjectTeamRole;
        created_at: string;
      }>;
      if (rows.length === 0) return [];
      const userIds = [...new Set(rows.map((r) => r.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url")
        .in("user_id", userIds);
      const byId = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      return rows
        .map((r) => ({ ...r, profile: byId.get(r.user_id) ?? null }))
        .sort((a, b) => {
          const rd = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
          if (rd !== 0) return rd;
          const an = a.profile?.full_name || a.profile?.email || "";
          const bn = b.profile?.full_name || b.profile?.email || "";
          return an.localeCompare(bn, "es");
        });
    },
  });
}

export function useAddProjectTeamMember() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      projectId,
      userId,
      role = "colaborador",
    }: {
      projectId: string;
      userId: string;
      role?: ProjectTeamRole;
    }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) throw new Error("Sin organización activa.");
      const { error } = await supabase.from("project_team").insert({
        project_id: projectId,
        user_id: userId,
        role,
        organization_id: profile.organization_id,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["project-team", vars.projectId] });
      toast.success("Miembro agregado al equipo");
    },
    onError: (err: Error) => {
      toast.error("Error al agregar miembro: " + err.message);
    },
  });
}

export function useUpdateProjectTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      role,
    }: {
      id: string;
      role: ProjectTeamRole;
      projectId: string;
    }) => {
      const { error } = await supabase
        .from("project_team")
        .update({ role })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["project-team", vars.projectId] });
      toast.success("Rol actualizado");
    },
    onError: (err: Error) => {
      toast.error("Error al actualizar rol: " + err.message);
    },
  });
}

export function useRemoveProjectTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; projectId: string }) => {
      const { error } = await supabase.from("project_team").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["project-team", vars.projectId] });
      toast.success("Miembro removido");
    },
    onError: (err: Error) => {
      toast.error("Error al remover miembro: " + err.message);
    },
  });
}
