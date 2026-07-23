import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { describeEdgeFnError } from "@/lib/edgeFnError";

export interface SavioSyncRun {
  id: string;
  organization_id: string;
  resource: "invoices" | "payments" | "customers";
  status: "ok" | "error" | "partial";
  fetched: number;
  upserted: number;
  savio_reported_total: number | null;
  truncated: boolean;
  discrepancy: boolean;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

/** Últimas corridas de sincronización Savio (para mostrar estado y última fecha). */
export function useSavioSyncRuns(limit = 12) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["savio-sync-runs"],
    queryFn: async (): Promise<SavioSyncRun[]> => {
      const { data, error } = await (supabase as any)
        .from("savio_sync_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as SavioSyncRun[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

/** Dispara la sincronización Savio→local (Edge Function savio-sync). */
export function useTriggerSavioSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resource?: "invoices" | "payments" | "customers") => {
      const { data, error } = await supabase.functions.invoke("savio-sync", {
        body: resource ? { resource } : {},
      });
      if (error) throw new Error(describeEdgeFnError(error, "savio-sync"));
      return data as { ok: boolean; runs: SavioSyncRun[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["savio-sync-runs"] });
      const total = (data?.runs ?? []).reduce((s, r) => s + (r.upserted || 0), 0);
      if (data?.ok) {
        toast.success(`Savio sincronizado: ${total} registros actualizados`);
      } else {
        toast.warning("Sincronización parcial de Savio; revisa la bitácora.");
      }
    },
    onError: (e: Error) => toast.error(e.message || "Error al sincronizar Savio"),
  });
}
