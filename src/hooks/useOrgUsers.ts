import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
  created_at: string;
  role?: string;
}

export function useOrgUsers() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["org-users"],
    queryFn: async () => {
      // Get profiles
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");

      if (error) throw error;

      // Get roles
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
        role: roleMap.get(p.user_id) || "staff",
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

interface CreateUserParams {
  email: string;
  full_name: string;
  password: string;
  role: string;
  area?: string;
  phone?: string;
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
