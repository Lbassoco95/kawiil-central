import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import { fetchSavioResource, type SavioFinanceApiAction } from "@/lib/savioFinanceInvoke";
import {
  extractSavioList,
  pickSavioString,
  sumInvoiceTotals,
  sumPaymentTotals,
  toInvoiceRowView,
  toPaymentRowView,
  type SavioInvoiceRowView,
  type SavioPaymentRowView,
} from "@/lib/savioApiNormalize";

export type { SavioFinanceApiAction };

type InvokeResult = Awaited<ReturnType<typeof fetchSavioResource>>;

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

  const customersQuery = useQuery({
    queryKey: ["savio-finance-api", "customers", user?.id],
    queryFn: () => fetchSavioResource("customers", DEFAULT_QUERY),
    enabled: allowSavio,
    staleTime: 120_000,
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

  const customerPickOptions = useMemo(() => {
    const data = customersQuery.data?.data;
    if (customersQuery.data?.ok !== true || !data) return [] as { id: string; label: string }[];
    const list = extractSavioList(data);
    const out: { id: string; label: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const id = pickSavioString(row, ["id", "uuid", "customer_id"]);
      if (!id || id === "—") continue;
      const name = pickSavioString(row, [
        "name",
        "legal_name",
        "company_name",
        "display_name",
        "business_name",
        "razon_social",
        "customer_name",
      ]);
      const label = name !== "—" ? `${name} · ${id.slice(0, 10)}${id.length > 10 ? "…" : ""}` : id;
      out.push({ id, label });
    }
    return out;
  }, [customersQuery.data]);

  const invoicePickOptions = useMemo(
    () =>
      invoiceRows.map((v) => ({
        id: v.id,
        label: `${v.folio} · ${v.cliente !== "—" ? v.cliente : "Cliente"}${v.monto != null ? ` · ${v.monto.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}` : ""}`,
      })),
    [invoiceRows],
  );

  const anyLoading =
    invoicesQuery.isLoading || paymentsQuery.isLoading || customersQuery.isLoading;
  const refetchAll = () => {
    void invoicesQuery.refetch();
    void paymentsQuery.refetch();
    void customersQuery.refetch();
  };

  const reactQueryError = invoicesQuery.error ?? paymentsQuery.error ?? customersQuery.error ?? null;

  return {
    invoiceRows,
    paymentRows,
    invoiceAgg,
    paymentAgg,
    invoicesMeta: invoicesQuery.data,
    paymentsMeta: paymentsQuery.data,
    customersMeta: customersQuery.data,
    customerPickOptions,
    invoicePickOptions,
    isLoading: anyLoading,
    isFetching:
      invoicesQuery.isFetching || paymentsQuery.isFetching || customersQuery.isFetching,
    refetchAll,
    reactQueryError,
    accessLoading: accessLoading || savioAccessLoading,
    canViewSavioIncome,
  };
}
