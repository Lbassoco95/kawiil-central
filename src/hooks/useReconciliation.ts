import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ReconciliationQueueRow {
  id: string;
  organization_id: string;
  payment_id: string;
  payment_savio_id: string | null;
  customer_savio_id: string | null;
  client_id: string | null;
  amount: number | null;
  currency: string;
  reason: "sin_factura" | "ambiguo" | "sobrepago";
  candidates: string[];
  status: "pendiente" | "resuelto" | "ignorado";
  created_at: string;
}

export const RECON_REASON_LABELS: Record<string, string> = {
  sin_factura: "Sin factura",
  ambiguo: "Ambiguo",
  sobrepago: "Sobrepago",
};

export interface InvoiceLite {
  id: string;
  savio_id: string;
  folio: string | null;
  amount: number | null;
  currency: string;
}

async function currentOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();
  if (error || !data?.organization_id) throw new Error("No se encontró la organización del usuario");
  return data.organization_id as string;
}

/** Cola de pagos por conciliar (pendientes). */
export function useReconciliationQueue() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reconciliation-queue"],
    queryFn: async (): Promise<ReconciliationQueueRow[]> => {
      const { data, error } = await (supabase as any)
        .from("reconciliation_queue")
        .select("*")
        .eq("status", "pendiente")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        candidates: Array.isArray(r.candidates) ? (r.candidates as string[]) : [],
      })) as ReconciliationQueueRow[];
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

/** Mapa de facturas (por savio_id) para mostrar candidatos en la cola. */
export function useInvoiceLiteMap(savioIds: string[]) {
  const { user } = useAuth();
  const key = savioIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["invoice-lite-map", key],
    queryFn: async (): Promise<Record<string, InvoiceLite>> => {
      if (savioIds.length === 0) return {};
      const { data, error } = await (supabase as any)
        .from("savio_invoices")
        .select("id, savio_id, folio, amount, currency")
        .in("savio_id", savioIds);
      if (error) throw error;
      const map: Record<string, InvoiceLite> = {};
      for (const r of (data ?? []) as InvoiceLite[]) map[r.savio_id] = r;
      return map;
    },
    enabled: !!user && savioIds.length > 0,
    staleTime: 60_000,
  });
}

/** Dispara la conciliación automática (Edge Function reconcile-payments). */
export function useTriggerReconcile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("reconcile-payments", { body: {} });
      if (error) throw new Error(error.message || "No se pudo conciliar");
      return data as { ok: boolean; applied: number; queued: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation-queue"] });
      queryClient.invalidateQueries({ queryKey: ["aging"] });
      toast.success(`Conciliación: ${data.applied} aplicados, ${data.queued} en cola`);
    },
    onError: (e: Error) => toast.error(e.message || "Error al conciliar"),
  });
}

/** Aplica manualmente un pago en cola a una factura y cierra el elemento de la cola. */
export function useResolveReconciliation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      item,
      invoice,
      monto,
      concepto,
    }: {
      item: ReconciliationQueueRow;
      invoice: InvoiceLite;
      monto: number;
      concepto?: string | null;
    }) => {
      const orgId = await currentOrgId(user!.id);
      const { error: piErr } = await (supabase as any).from("payment_invoice").upsert(
        {
          organization_id: orgId,
          payment_id: item.payment_id,
          invoice_id: invoice.id,
          payment_savio_id: item.payment_savio_id,
          invoice_savio_id: invoice.savio_id,
          monto_aplicado: Number(monto.toFixed(2)),
          concepto: concepto?.trim() || null,
          auto: false,
          created_by: user!.id,
        },
        { onConflict: "organization_id,payment_id,invoice_id" },
      );
      if (piErr) throw piErr;
      const { error: qErr } = await (supabase as any)
        .from("reconciliation_queue")
        .update({ status: "resuelto", resolved_by: user!.id, resolved_at: new Date().toISOString() })
        .eq("id", item.id);
      if (qErr) throw qErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation-queue"] });
      queryClient.invalidateQueries({ queryKey: ["aging"] });
      toast.success("Pago aplicado a la factura");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo aplicar el pago"),
  });
}

/** Marca un elemento de la cola como ignorado. */
export function useIgnoreReconciliation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("reconciliation_queue")
        .update({ status: "ignorado", resolved_by: user!.id, resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reconciliation-queue"] });
      toast.success("Elemento ignorado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo ignorar"),
  });
}
