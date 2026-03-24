import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgSettings } from "@/hooks/useOrgSettings";

export function useUserRole() {
  const { user } = useAuth();
  const { settings } = useOrgSettings();

  const { data: role } = useQuery({
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

  const currentRole = role || "ejecutor";
  const isTransformador = currentRole === "transformador";
  const isReferente = currentRole === "referente";
  const isReferenteOrAbove = isTransformador || isReferente;

  // Granular permissions
  const canDeleteTasks = isTransformador || (isReferente && !!settings.referente_delete_tasks);
  const canEditDueDates = isTransformador || (isReferente && !!settings.referente_edit_due_dates);
  const canManageTasks = canDeleteTasks || canEditDueDates;

  return {
    role: currentRole,
    grado: currentRole,
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
