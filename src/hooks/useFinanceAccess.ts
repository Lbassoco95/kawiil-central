import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";

export function useFinanceAccess() {
  const { user } = useAuth();
  const { isAdminOrManager } = useUserRole();

  const { data: hasFinanceCelula = false, isLoading } = useQuery({
    queryKey: ["finance-access", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_celulas")
        .select("id, celulas!inner(slug)")
        .eq("user_id", user.id);
      if (error) return false;
      return (data || []).some((uc: any) =>
        ["finanzas", "administracion", "administraci_n"].includes(uc.celulas?.slug)
      );
    },
    enabled: !!user,
  });

  return {
    hasFinanceAccess: hasFinanceCelula || isAdminOrManager,
    isLoading,
  };
}
