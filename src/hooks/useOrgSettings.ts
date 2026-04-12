import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface OrgSettings {
  referente_task_management?: boolean;
  referente_delete_tasks?: boolean;
  referente_edit_due_dates?: boolean;
  /** Si está definido y no vacío, solo este usuario (transformador) puede editar permisos de módulos y settings de permisos de la org. */
  permissions_steward_user_id?: string | null;
}

/** Transformador con permiso para mutar `user_module_permissions` y `organizations.settings` de permisos (RLS alineado). */
export function canActAsOrgPermissionsSteward(
  settings: OrgSettings,
  currentUserId: string | undefined,
): boolean {
  if (!currentUserId) return false;
  const raw = settings.permissions_steward_user_id;
  if (raw == null || String(raw).trim() === "") return true;
  return String(raw).trim() === currentUserId;
}

export function useOrgSettings() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["org-settings"],
    queryFn: async () => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      if (!orgId) return {} as OrgSettings;

      const { data, error } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .single();

      if (error) return {} as OrgSettings;
      return (data?.settings as OrgSettings) || {};
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  return {
    settings: query.data || ({} as OrgSettings),
    isLoading: query.isLoading,
  };
}

export function useUpdateOrgSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newSettings: Partial<OrgSettings>) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      if (!orgId) throw new Error("No org found");

      // Get current settings first
      const { data: current } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", orgId)
        .single();

      const merged = { ...((current?.settings as OrgSettings) || {}), ...newSettings };

      const { error } = await supabase
        .from("organizations")
        .update({ settings: merged } as any)
        .eq("id", orgId);

      if (error) throw error;
      return merged;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-settings"] });
      toast.success("Configuración actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar configuración");
    },
  });
}
