import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { moffinConsultNeedsApiSync, type MoffinConsultRow } from "@/lib/moffinDisplay";

export function useMoffinConsultsByClient(clientId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
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
    refetchInterval: (q) => {
      const rows = q.state.data as MoffinConsultRow[] | undefined;
      return rows?.some((r) => moffinConsultNeedsApiSync(r)) ? 55_000 : false;
    },
  });
}
