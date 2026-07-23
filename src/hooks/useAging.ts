import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AgingRow {
  organization_id: string;
  client_id: string | null;
  customer_savio_id: string | null;
  currency: string;
  invoices: number;
  total_balance: number;
  corriente: number;
  d1_15: number;
  d16_30: number;
  d31_60: number;
  d60_plus: number;
  max_days_late: number;
  /** Nombre resoluble del cliente (local o Savio). */
  clientName: string;
}

export interface AgingTotals {
  currency: string;
  total_balance: number;
  corriente: number;
  d1_15: number;
  d16_30: number;
  d31_60: number;
  d60_plus: number;
  invoices: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Antigüedad de saldos (aging) por cliente y moneda, desde la vista v_aging.
 * Requiere acceso a Finanzas (RLS). Los nombres de cliente se resuelven contra
 * clients y savio_customers.
 */
export function useAging() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["aging"],
    queryFn: async (): Promise<{ rows: AgingRow[]; totals: AgingTotals[] }> => {
      const [{ data: agingData, error }, clientsRes, savioCustRes] = await Promise.all([
        (supabase as any).from("v_aging").select("*"),
        supabase.from("clients").select("id, name"),
        (supabase as any).from("savio_customers").select("savio_id, name"),
      ]);
      if (error) throw error;

      const clientName = new Map<string, string>();
      for (const c of (clientsRes.data ?? []) as { id: string; name: string }[]) {
        clientName.set(c.id, c.name);
      }
      const savioName = new Map<string, string>();
      for (const c of ((savioCustRes.data ?? []) as { savio_id: string; name: string | null }[])) {
        if (c.name) savioName.set(c.savio_id, c.name);
      }

      const rows: AgingRow[] = ((agingData ?? []) as Record<string, unknown>[]).map((r) => {
        const client_id = (r.client_id as string) ?? null;
        const customer_savio_id = (r.customer_savio_id as string) ?? null;
        const name =
          (client_id && clientName.get(client_id)) ||
          (customer_savio_id && savioName.get(customer_savio_id)) ||
          customer_savio_id ||
          "Sin cliente asignado";
        return {
          organization_id: r.organization_id as string,
          client_id,
          customer_savio_id,
          currency: (r.currency as string) || "MXN",
          invoices: num(r.invoices),
          total_balance: num(r.total_balance),
          corriente: num(r.corriente),
          d1_15: num(r.d1_15),
          d16_30: num(r.d16_30),
          d31_60: num(r.d31_60),
          d60_plus: num(r.d60_plus),
          max_days_late: num(r.max_days_late),
          clientName: name,
        };
      });

      // Totales por moneda.
      const byCurrency = new Map<string, AgingTotals>();
      for (const r of rows) {
        const t =
          byCurrency.get(r.currency) ??
          {
            currency: r.currency,
            total_balance: 0,
            corriente: 0,
            d1_15: 0,
            d16_30: 0,
            d31_60: 0,
            d60_plus: 0,
            invoices: 0,
          };
        t.total_balance += r.total_balance;
        t.corriente += r.corriente;
        t.d1_15 += r.d1_15;
        t.d16_30 += r.d16_30;
        t.d31_60 += r.d31_60;
        t.d60_plus += r.d60_plus;
        t.invoices += r.invoices;
        byCurrency.set(r.currency, t);
      }

      const totals = Array.from(byCurrency.values()).sort((a, b) => b.total_balance - a.total_balance);
      const sortedRows = rows.sort((a, b) => b.total_balance - a.total_balance);
      return { rows: sortedRows, totals };
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}
