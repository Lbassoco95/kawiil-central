import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import {
  extractSavioList,
  sumInvoiceTotals,
  sumPaymentTotals,
  toInvoiceRowView,
  toPaymentRowView,
  type SavioInvoiceRowView,
  type SavioPaymentRowView,
} from "@/lib/savioApiNormalize";

export type SavioFinanceApiAction = "invoices" | "payments";

type InvokeResult = {
  ok?: boolean;
  savio_http_status?: number;
  action?: string;
  path?: string;
  data?: unknown;
  error?: string;
  missing?: string[];
  message?: string;
};

async function invokeErrorBody(error: unknown): Promise<InvokeResult | null> {
  if (!error || typeof error !== "object") return null;
  const ctx = (error as { context?: unknown }).context;
  if (
    ctx &&
    typeof ctx === "object" &&
    "json" in ctx &&
    typeof (ctx as Response).json === "function"
  ) {
    try {
      const parsed = await (ctx as Response).json();
      if (parsed && typeof parsed === "object") {
        return { ok: false, ...(parsed as InvokeResult) };
      }
    } catch {
      /* cuerpo no JSON */
    }
  }
  return null;
}

async function fetchSavioResource(
  action: SavioFinanceApiAction,
  query: Record<string, string>,
): Promise<InvokeResult> {
  const { data, error } = await supabase.functions.invoke("savio-finance-api", {
    body: { action, query },
  });
  if (error) {
    const fromHttp = await invokeErrorBody(error);
    if (fromHttp) return fromHttp;
    return { ok: false, error: error.message || "invoke_error" };
  }
  return (data || {}) as InvokeResult;
}

const DEFAULT_QUERY = { limit: "100" };

/**
 * Datos en vivo desde la API Savio (vía Edge). Requiere Finanzas + permiso ingresos (finance_income_viewers).
 */
export function useSavioFinanceApiData() {
  const { user } = useAuth();
  const { hasFinanceAccess, isLoading: accessLoading } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioAccessLoading } = useSavioIncomeAccess();

  const allowSavio = !!user && hasFinanceAccess && canViewSavioIncome && !accessLoading && !savioAccessLoading;

  const invoicesQuery = useQuery({
    queryKey: ["savio-finance-api", "invoices", user?.id],
    queryFn: () => fetchSavioResource("invoices", DEFAULT_QUERY),
    enabled: allowSavio,
    staleTime: 60_000,
  });

  const paymentsQuery = useQuery({
    queryKey: ["savio-finance-api", "payments", user?.id],
    queryFn: () => fetchSavioResource("payments", DEFAULT_QUERY),
    enabled: allowSavio,
    staleTime: 60_000,
  });

  const invoiceRows: SavioInvoiceRowView[] = (() => {
    const data = invoicesQuery.data?.data;
    return extractSavioList(data).map((row, i) => toInvoiceRowView(row, i));
  })();

  const paymentRows: SavioPaymentRowView[] = (() => {
    const data = paymentsQuery.data?.data;
    return extractSavioList(data).map((row, i) => toPaymentRowView(row, i));
  })();

  const invoiceAgg = sumInvoiceTotals(invoiceRows);
  const paymentAgg = sumPaymentTotals(paymentRows);

  const anyLoading = invoicesQuery.isLoading || paymentsQuery.isLoading;
  const refetchAll = () => {
    void invoicesQuery.refetch();
    void paymentsQuery.refetch();
  };

  const reactQueryError = invoicesQuery.error ?? paymentsQuery.error ?? null;

  return {
    invoiceRows,
    paymentRows,
    invoiceAgg,
    paymentAgg,
    invoicesMeta: invoicesQuery.data,
    paymentsMeta: paymentsQuery.data,
    isLoading: anyLoading,
    isFetching: invoicesQuery.isFetching || paymentsQuery.isFetching,
    refetchAll,
    reactQueryError,
    accessLoading: accessLoading || savioAccessLoading,
    canViewSavioIncome,
  };
}
