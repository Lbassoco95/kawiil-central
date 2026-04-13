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

const DEFAULT_QUERY: Record<string, string> = { limit: "100" };

export type SavioCustomerRowView = {
  key: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  /** RFC / tax id si Savio lo envía en el payload. */
  rfc: string | null;
  id: string;
  raw: unknown;
};

export type UseSavioFinanceApiOptions = {
  /** Si se indica, GET /invoice con filtro `customer_id` (si Savio lo admite). */
  invoiceCustomerId?: string | null;
  /** Si es false, no dispara las consultas Savio (p. ej. ficha sin `savio_customer_id`). Default true. */
  fetchEnabled?: boolean;
};

/**
 * Datos en vivo desde la API Savio (vía Edge). Requiere Finanzas + permiso ingresos (finance_income_viewers).
 */
export function useSavioFinanceApiData(opts?: UseSavioFinanceApiOptions) {
  const { user } = useAuth();
  const { hasFinanceAccess, isLoading: accessLoading } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioAccessLoading } = useSavioIncomeAccess();

  const allowSavio = !!user && hasFinanceAccess && canViewSavioIncome && !accessLoading && !savioAccessLoading;
  const apiEnabled = allowSavio && (opts?.fetchEnabled ?? true);

  const invoiceQuery = useMemo(() => {
    const q = { ...DEFAULT_QUERY };
    const cid = opts?.invoiceCustomerId?.trim();
    if (cid) q.customer_id = cid;
    return q;
  }, [opts?.invoiceCustomerId]);

  const invoicesQuery = useQuery({
    queryKey: ["savio-finance-api", "invoices", user?.id, invoiceQuery.customer_id ?? ""],
    queryFn: () => fetchSavioResource("invoices", invoiceQuery),
    enabled: apiEnabled,
    staleTime: 60_000,
  });

  const paymentsQuery = useQuery({
    queryKey: ["savio-finance-api", "payments", user?.id],
    queryFn: () => fetchSavioResource("payments", DEFAULT_QUERY),
    enabled: apiEnabled,
    staleTime: 60_000,
  });

  const customersQuery = useQuery({
    queryKey: ["savio-finance-api", "customers", user?.id],
    queryFn: () => fetchSavioResource("customers", DEFAULT_QUERY),
    enabled: apiEnabled,
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

  const customerRows: SavioCustomerRowView[] = useMemo(() => {
    const data = customersQuery.data?.data;
    if (customersQuery.data?.ok !== true || !data) return [];
    const list = extractSavioList(data);
    return list.map((row, i) => {
      const id = pickSavioString(row, ["id", "uuid", "customer_id"]);
      const displayName = pickSavioString(row, [
        "name",
        "legal_name",
        "company_name",
        "display_name",
        "business_name",
        "razon_social",
        "customer_name",
      ]);
      const emailRaw = pickSavioString(row, ["email", "contact_email", "mail"]);
      const phoneRaw = pickSavioString(row, ["phone", "telephone", "mobile", "tel"]);
      const rfcRaw = pickSavioString(row, ["rfc", "tax_id", "taxId", "RFC", "rfc_fiscal"]);
      return {
        key: id !== "—" ? id : `c-${i}`,
        id: id !== "—" ? id : `c-${i}`,
        displayName: displayName !== "—" ? displayName : id !== "—" ? id.slice(0, 12) : `Cliente ${i + 1}`,
        email: emailRaw === "—" ? null : emailRaw,
        phone: phoneRaw === "—" ? null : phoneRaw,
        rfc: rfcRaw === "—" ? null : rfcRaw,
        raw: row,
      };
    });
  }, [customersQuery.data]);

  const invoiceAgg = sumInvoiceTotals(invoiceRows);
  const paymentAgg = sumPaymentTotals(paymentRows);

  const customerPickOptions = useMemo(() => {
    return customerRows.map((r) => ({
      id: r.id,
      label: r.displayName,
      subtitle: [r.email, r.phone, r.rfc, `${r.id.slice(0, 12)}${r.id.length > 12 ? "…" : ""}`]
        .filter(Boolean)
        .join(" · "),
    }));
  }, [customerRows]);

  const invoicePickOptions = useMemo(
    () =>
      invoiceRows.map((v) => {
        const money =
          v.monto != null ? v.monto.toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : null;
        const subtitle = [v.cliente !== "—" ? v.cliente : null, v.estado, money].filter(Boolean).join(" · ");
        return { id: v.id, label: v.folio, subtitle: subtitle || undefined };
      }),
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
    customerRows,
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
    invoiceQueryActive: !!opts?.invoiceCustomerId?.trim(),
  };
}
