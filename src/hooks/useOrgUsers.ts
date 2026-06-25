import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { KawiilerPermissionsJson } from "@/lib/kawiilerPermissions";

export type OnboardingStatus = 'invited' | 'link_opened' | 'password_set' | 'active';

export interface OrgUser {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  area: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  invitation_accepted: boolean;
  onboarding_status: OnboardingStatus;
  created_at: string;
  role?: string;
  kawiiler_permissions?: KawiilerPermissionsJson | null;
}

export function useOrgUsers() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["org-users"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");

      if (error) throw error;

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("*");

      if (rolesError) throw rolesError;

      const roleMap = new Map<string, string>();
      roles?.forEach((r) => {
        roleMap.set(r.user_id, r.role);
      });

      return (profiles || []).map((p) => ({
        ...p,
        role: roleMap.get(p.user_id) || "ejecutor",
      })) as OrgUser[];
    },
    enabled: !!user,
  });
}

interface InviteUserParams {
  email: string;
  full_name: string;
  role: string;
  area?: string;
  phone?: string;
}

export function useInviteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: InviteUserParams) => {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: params,
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["org-profiles"] });
      toast.success(data.message || "Invitación enviada");
    },
    onError: (error) => {
      toast.error(error.message || "Error al invitar usuario");
    },
  });
}

interface UpdateUserEmailParams {
  user_id: string;
  new_email: string;
  /** Si true (default), envía el enlace de acceso al nuevo correo. */
  send_link?: boolean;
}

export function useUpdateUserEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateUserEmailParams) => {
      const { data, error } = await supabase.functions.invoke("update-user-email", {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; link_sent?: boolean; message?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["org-profiles"] });
      toast.success(data.message || "Correo actualizado");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Error al cambiar el correo");
    },
  });
}

interface CreateUserParams {
  email: string;
  full_name: string;
  password: string;
  role: string;
  area?: string;
  phone?: string;
  microsoft_email?: string;
  microsoft_user_id?: string;
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateUserParams) => {
      const { data, error } = await supabase.functions.invoke("create-user", {
        body: params,
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["org-profiles"] });
      toast.success(data.message || "Usuario creado");
    },
    onError: (error) => {
      toast.error(error.message || "Error al crear usuario");
    },
  });
}
