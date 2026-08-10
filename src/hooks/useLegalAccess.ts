import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";

/** Células que dan acceso al área de litigio / legal. */
const LEGAL_CELULA_SLUGS = ["legal", "juicios", "gestoria"];

/**
 * Determina si el usuario pertenece al área legal (litigio/gestoría) y por tanto
 * debe ver la vista de Litigio. Acceso = miembro de una célula legal, o
 * admin/manager. Sigue el mismo patrón que useFinanceAccess.
 */
export function useLegalAccess() {
  const { user } = useAuth();
  const { isAdminOrManager } = useUserRole();

  const { data: hasLegalCelula = false, isLoading } = useQuery({
    queryKey: ["legal-access", "celula", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_celulas")
        .select("id, celulas!inner(slug)")
        .eq("user_id", user.id);
      if (error) return false;
      return (data || []).some((uc: { celulas?: { slug?: string } }) =>
        LEGAL_CELULA_SLUGS.includes(uc.celulas?.slug ?? ""),
      );
    },
    enabled: !!user,
  });

  return {
    hasLegalAccess: hasLegalCelula || isAdminOrManager,
    isLoading,
  };
}
