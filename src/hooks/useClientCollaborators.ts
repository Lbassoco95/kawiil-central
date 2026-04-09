import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** user_id explícitos de seguimiento del cliente (tabla client_collaborators). */
export function useClientCollaboratorIds(clientId: string | undefined, enabled = true) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["client-collaborators", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_collaborators")
        .select("user_id")
        .eq("client_id", clientId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id);
    },
    enabled: !!user && !!clientId && enabled,
  });
}
