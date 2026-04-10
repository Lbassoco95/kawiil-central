import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";

export function useFinanceAccess() {
  const { user } = useAuth();
  const { isAdminOrManager } = useUserRole();

  const { data: hasFinanceCelula = false, isLoading: celulaLoading } = useQuery({
    queryKey: ["finance-access", "celula", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_celulas")
        .select("id, celulas!inner(slug)")
        .eq("user_id", user.id);
      if (error) return false;
      return (data || []).some((uc: { celulas?: { slug?: string } }) =>
        ["finanzas", "administracion", "administraci_n"].includes(uc.celulas?.slug ?? ""),
      );
    },
    enabled: !!user,
  });

  const { data: hasFinanceModule = false, isLoading: moduleLoading } = useQuery({
    queryKey: ["finance-access", "module", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_module_permissions")
        .select("enabled")
        .eq("user_id", user.id)
        .eq("module_key", "finanzas")
        .maybeSingle();
      if (error) return false;
      return !!data?.enabled;
    },
    enabled: !!user,
  });

  return {
    hasFinanceAccess: hasFinanceCelula || isAdminOrManager || hasFinanceModule,
    isLoading: celulaLoading || moduleLoading,
  };
}
