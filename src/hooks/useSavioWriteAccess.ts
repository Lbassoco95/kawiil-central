import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type SavioWriteAccessData = {
  canWrite: boolean;
  /** Si el RPC falla (p. ej. migración no aplicada), el front puede mostrar aviso en lugar de ocultar todo. */
  rpcError?: string;
};

/** Permiso para crear cargos / registrar pagos (además de ver ingresos). */
export function useSavioWriteAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["savio-write-access", user?.id],
    queryFn: async (): Promise<SavioWriteAccessData> => {
      if (!user?.id) return { canWrite: false };
      const { data, error } = await supabase.rpc("can_write_savio_finance", { _user_id: user.id });
      if (error) {
        console.warn("can_write_savio_finance:", error.message);
        return { canWrite: false, rpcError: error.message };
      }
      return { canWrite: data === true };
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
