import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface FinanceEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_html: string;
}

/**
 * Plantilla de correo del reporte de reembolso a cliente (scope 'finance').
 * Si aún no existe en la base (migración no aplicada), devuelve null y el
 * generador de reportes usa una plantilla por defecto.
 */
export function useFinanceReimbursementTemplate() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["finance-reimbursement-template"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<FinanceEmailTemplate | null> => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("id, name, subject, body_html")
        .eq("scope", "finance")
        .eq("category", "reembolso_cliente")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data as FinanceEmailTemplate) ?? null;
    },
  });
}
