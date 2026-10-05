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
  "reclutamiento",
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
  reclutamiento: "Reclutamiento",
};

export function useModulePermissions() {
  const { user } = useAuth();

  const { data: permissions, isLoading, isError, error, refetch, isFetched } = useQuery({
    queryKey: ["module-permissions", user?.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("user_module_permissions")
        .select("module_key, enabled")
        .eq("user_id", user!.id);
      // Antes se tragaba el error y devolvía {} → sidebar sin Correo/RH/Pipeline
      // aunque el usuario sí tenía permisos en BD.
      if (qErr) throw qErr;
      const map: Record<string, boolean> = {};
      for (const row of data || []) {
        map[row.module_key] = row.enabled;
      }
      return map;
    },
    enabled: !!user,
    staleTime: 3 * 60 * 1000,
    retry: 2,
  });

  const map = permissions ?? {};

  // Fail-open si la API no respondió: ocultar módulos por timeout engaña al
  // usuario (parece que "faltan módulos"). Con datos reales, respeta enabled.
  const hasModule = (key: string): boolean => {
    if (!isFetched || isError) return true;
    if (!(key in map)) return false;
    return !!map[key];
  };

  return {
    permissions: map,
    hasModule,
    isLoading,
    isError,
    error,
    refetch,
  };
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
