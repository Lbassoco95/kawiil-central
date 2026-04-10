import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Permiso adicional para ver ingresos Savio (tabla finance_income_viewers).
 * Independiente de has_finance_access (gastos).
 */
export function useSavioIncomeAccess() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["savio-income-access", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase.rpc("can_view_savio_finance", { _user_id: user.id });
      if (error) {
        console.warn("can_view_savio_finance:", error.message);
        return false;
      }
      return Boolean(data);
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}
