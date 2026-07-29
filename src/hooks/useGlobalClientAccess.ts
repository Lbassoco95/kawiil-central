import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * user_id de los perfiles marcados con acceso global a la cartera (RF-06).
 * Estos usuarios se tratan como colaboradores en todos los clientes sin insertar
 * una fila por cliente. Usa `as any` porque la columna aún no está en los tipos
 * generados de Supabase (patrón ya usado en el repo).
 */
export function useGlobalClientAccessUserIds() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["global-client-access-user-ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles" as any)
        .select("user_id")
        .eq("has_global_client_access", true)
        .eq("is_active", true);
      if (error) throw error;
      return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}
