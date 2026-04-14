import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { moffinConsultNeedsApiSync, type MoffinConsultRow } from "@/lib/moffinDisplay";

export function useMoffinConsultsByClient(clientId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["moffin-consults-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("moffin_consults")
        .select(
          "id, consult_type, status, summary, created_at, raw_response, document_id, error_message, moffin_query_id, documents(file_path, name)"
        )
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as MoffinConsultRow[];
    },
    enabled: !!user && !!clientId,
    refetchInterval: false,
  });

  const hasPendingSync = useMemo(
    () => (query.data ?? []).some((r) => moffinConsultNeedsApiSync(r)),
    [query.data],
  );

  useEffect(() => {
    if (!user || !clientId || !hasPendingSync) return;
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["moffin-consults-client", clientId] });
    }, 55_000);
    return () => clearInterval(id);
  }, [user, clientId, hasPendingSync, queryClient]);

  return query;
}
