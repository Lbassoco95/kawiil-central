import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/** Permiso para crear cargos / registrar pagos (además de ver ingresos). */
export function useSavioWriteAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["savio-write-access", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase.rpc("can_write_savio_finance", { _user_id: user.id });
      if (error) {
        console.warn("can_write_savio_finance:", error.message);
        return false;
      }
      return data === true;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
