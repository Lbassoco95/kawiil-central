import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  parseKawiilerPermissions,
  effectiveCanDeleteTasks,
  effectiveCanEditTaskDueDates,
} from "@/lib/kawiilerPermissions";

export function useUserRole() {
  const { user } = useAuth();

  const { data: role, isLoading: roleLoading } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .single();
      if (error) return "ejecutor";
      return data.role;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const { data: kawiilerPermsRaw } = useQuery({
    queryKey: ["profile-kawiiler-permissions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("kawiiler_permissions")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error || !data) return {};
      return parseKawiilerPermissions(data.kawiiler_permissions);
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const currentRole = role || "ejecutor";
  const isTransformador = currentRole === "transformador";
  const isReferente = currentRole === "referente";
  const isReferenteOrAbove = isTransformador || isReferente;

  const kp = kawiilerPermsRaw || {};
  const canDeleteTasks = effectiveCanDeleteTasks(currentRole, kp);
  const canEditDueDates = effectiveCanEditTaskDueDates(currentRole, kp);
  const canManageTasks = canDeleteTasks || canEditDueDates;

  return {
    role: currentRole,
    grado: currentRole,
    isLoading: roleLoading,
    isTransformador,
    isReferenteOrAbove,
    canManageTasks,
    canDeleteTasks,
    canEditDueDates,
    // Backward-compatible aliases
    isAdmin: isTransformador,
    isAdminOrManager: isReferenteOrAbove,
  };
}
