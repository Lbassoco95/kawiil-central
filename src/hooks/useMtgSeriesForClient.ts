import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { mtgDb, type MtgSeriesRow } from "@/lib/mtg/db";
import { supabase } from "@/integrations/supabase/client";

async function fetchSeriesForClient(clientId: string): Promise<MtgSeriesRow[]> {
  const { data: groupRows, error: groupErr } = await supabase
    .from("client_group_members")
    .select("group_id")
    .eq("client_id", clientId);
  if (groupErr) throw groupErr;

  const groupIds = (groupRows ?? []).map((r) => r.group_id);

  const { data: byClient, error: errClient } = await mtgDb
    .from("mtg_series")
    .select("*")
    .eq("active", true)
    .eq("anchor_type", "client")
    .eq("client_id", clientId)
    .order("title");
  if (errClient) throw errClient;

  let byGroup: MtgSeriesRow[] = [];
  if (groupIds.length > 0) {
    const { data, error } = await mtgDb
      .from("mtg_series")
      .select("*")
      .eq("active", true)
      .eq("anchor_type", "group")
      .in("client_group_id", groupIds)
      .order("title");
    if (error) throw error;
    byGroup = (data ?? []) as MtgSeriesRow[];
  }

  const merged = new Map<string, MtgSeriesRow>();
  for (const row of [...(byClient ?? []), ...byGroup] as MtgSeriesRow[]) {
    merged.set(row.id, row);
  }
  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title, "es"));
}

export function useMtgSeriesForClient(clientId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["mtg-series-client", clientId],
    queryFn: () => fetchSeriesForClient(clientId!),
    enabled: !!user && !!clientId,
  });
}
