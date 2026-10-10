import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/** Recordatorios de COBRANZA (RF-03), distintos de los recordatorios personales. */
export interface CollectionReminderLogRow {
  id: string;
  organization_id: string;
  savio_invoice_id: string;
  client_id: string | null;
  customer_savio_id: string | null;
  stage: "antes_venc" | "al_vencer" | "atraso";
  canal: string;
  destino: string | null;
  estado: "enviado" | "error" | "omitido";
  error: string | null;
  sent_on: string;
  enviado_at: string | null;
  created_at: string;
}

export const REMINDER_STAGE_LABELS: Record<string, string> = {
  antes_venc: "Antes de vencer",
  al_vencer: "Al vencer",
  atraso: "En atraso",
};

/** Bitácora de recordatorios de cobranza. */
export function useCollectionReminderLog(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["collection-reminder-log"],
    queryFn: async (): Promise<CollectionReminderLogRow[]> => {
      const { data, error } = await (supabase as any)
        .from("reminder_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as CollectionReminderLogRow[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

/** Pausa/reactiva los recordatorios de un cliente (por su savio_id). */
export function useToggleReminderPause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ customerSavioId, paused }: { customerSavioId: string; paused: boolean }) => {
      const { error } = await (supabase as any)
        .from("savio_customers")
        .update({ reminders_paused: paused })
        .eq("savio_id", customerSavioId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["aging"] });
      toast.success(vars.paused ? "Recordatorios pausados para el cliente" : "Recordatorios reactivados");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar la pausa"),
  });
}
