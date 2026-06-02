import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const MODULE_KEYS = [
  "ai",
  "conocimiento",
  "finanzas",
  "calendario",
  "correo",
  "documentos",
  "hub",
  "admin",
  "pipeline",
  "rh",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  ai: "Kawiil AI",
  conocimiento: "Conocimiento",
  finanzas: "Finanzas",
  calendario: "Calendario",
  correo: "Correo",
  documentos: "Documentos",
  hub: "Hub",
  admin: "Administración",
  pipeline: "Pipeline",
  rh: "Recursos Humanos",
};

export function useModulePermissions() {
  const { user } = useAuth();

  const { data: permissions = {}, isLoading } = useQuery({
    queryKey: ["module-permissions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_module_permissions")
        .select("module_key, enabled")
        .eq("user_id", user!.id);
      if (error) return {};
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        map[row.module_key] = row.enabled;
      }
      return map;
    },
    enabled: !!user,
    staleTime: 3 * 60 * 1000,
  });

  const hasModule = (key: string): boolean => !!permissions[key];

  return { permissions, hasModule, isLoading };
}

export function useUserModulePermissions(userId: string | undefined) {
  return useQuery({
    queryKey: ["module-permissions", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_module_permissions")
        .select("module_key, enabled")
        .eq("user_id", userId!);
      if (error) return {};
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        map[row.module_key] = row.enabled;
      }
      return map;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

export function useSyncModulePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      organizationId,
      modules,
    }: {
      userId: string;
      organizationId: string;
      modules: Record<string, boolean>;
    }) => {
      const rows = Object.entries(modules).map(([key, enabled]) => ({
        user_id: userId,
        organization_id: organizationId,
        module_key: key,
        enabled,
      }));

      for (const row of rows) {
        const { error } = await supabase
          .from("user_module_permissions")
          .upsert(row, { onConflict: "user_id,module_key" });
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["module-permissions", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["module-permissions"] });
    },
  });
}
