import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useUserRole() {
  const { user } = useAuth();

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
  const isReferenteOrAbove = currentRole === "transformador" || currentRole === "referente";

  return {
    role: currentRole,
    grado: currentRole,
    isTransformador,
    isReferenteOrAbove,
    // Backward-compatible aliases
    isAdmin: isTransformador,
    isAdminOrManager: isReferenteOrAbove,
  };
}
