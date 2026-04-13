import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { Expense } from "@/hooks/useExpenses";
import type { Client } from "@/hooks/useClients";
import {
  addMonths,
  getMonthRangeLocal,
  sumExpensesPaidInRange,
  sumSavioInvoicedInRange,
  sumSavioPaymentsInRange,
  yearMonthFromDate,
  type YearMonth,
} from "@/lib/financeMonthMetrics";
import { toInvoiceRowView } from "@/lib/savioApiNormalize";
import {
  buildInvoiceCollectionQueues,
  computeFinanceRatioPack,
  listMultiServiceClients,
  portfolioOutstandingFromRows,
  rollupSavioPaymentsByCustomerInRange,
} from "@/lib/financeIntelligenceMetrics";
import type { FinanceLocalDateRange } from "@/lib/financePeriodRange";
import { unionFinanceRanges } from "@/lib/financePeriodRange";
import {
  fetchSavioInvoicesWindow,
  fetchSavioPaymentsWindow,
  getSavioFinancePagedMaxPages,
  getSavioFinancePortfolioPagedMaxPages,
  MAX_SAVIO_FINANCE_PAGED_CEILING,
  SAVIO_FINANCE_PAGE_BOOST_STEP,
} from "@/lib/savioFinancePagedFetch";

const TOP_CLIENTS_FOR_RATIO = 5;

export function useFinanceIntelligenceData(
  primaryRange: FinanceLocalDateRange,
  compareRange: FinanceLocalDateRange | null,
  expenses: Expense[],
  clients: Client[],
  options: { enableSavio: boolean },
) {
  const { user } = useAuth();
  const enableSavio = options.enableSavio && !!user;

  const unionPaymentsRange = useMemo(
    () => unionFinanceRanges(primaryRange, compareRange),
    [primaryRange, compareRange],
  );

  const currentYm = useMemo((): YearMonth => yearMonthFromDate(new Date()), []);
  const portfolioRange = useMemo(() => {
    const start = getMonthRangeLocal(addMonths(currentYm, -48)).start;
    const end = getMonthRangeLocal(currentYm).end;
    return { start, end };
  }, [currentYm]);

  const basePaymentsMaxPages = getSavioFinancePagedMaxPages();
  const basePortfolioMaxPages = getSavioFinancePortfolioPagedMaxPages();
  const [pagedFetchBoost, setPagedFetchBoost] = useState(0);
  const paymentsMaxPages = Math.min(
    basePaymentsMaxPages + pagedFetchBoost,
    MAX_SAVIO_FINANCE_PAGED_CEILING,
  );
  const portfolioMaxPages = Math.min(
    basePortfolioMaxPages + pagedFetchBoost,
    MAX_SAVIO_FINANCE_PAGED_CEILING,
  );

  const loadMoreSavioPages = useCallback(() => {
    setPagedFetchBoost((b) => {
      const next = b + SAVIO_FINANCE_PAGE_BOOST_STEP;
      const cap = Math.max(
        0,
        MAX_SAVIO_FINANCE_PAGED_CEILING - Math.min(basePaymentsMaxPages, basePortfolioMaxPages),
      );
      return Math.min(next, cap);
    });
  }, [basePaymentsMaxPages, basePortfolioMaxPages]);

  const paymentsQuery = useQuery({
    queryKey: [
      "finance-intelligence",
      "payments",
      user?.id,
      unionPaymentsRange.start.toISOString(),
      unionPaymentsRange.end.toISOString(),
      paymentsMaxPages,
    ],
    queryFn: () =>
      fetchSavioPaymentsWindow(unionPaymentsRange.start, unionPaymentsRange.end, paymentsMaxPages),
    enabled: enableSavio,
    staleTime: 60_000,
  });

  const invoicesPortfolioQuery = useQuery({
    queryKey: [
      "finance-intelligence",
      "invoices-portfolio",
      user?.id,
      portfolioRange.start.toISOString(),
      portfolioRange.end.toISOString(),
      portfolioMaxPages,
    ],
    queryFn: () =>
      fetchSavioInvoicesWindow(portfolioRange.start, portfolioRange.end, portfolioMaxPages),
    enabled: enableSavio,
    staleTime: 60_000,
  });

  const paymentRows = useMemo(() => paymentsQuery.data?.rows ?? [], [paymentsQuery.data]);
  const invoiceRawRows = useMemo(() => invoicesPortfolioQuery.data?.rows ?? [], [invoicesPortfolioQuery.data]);

  const truncated =
    (paymentsQuery.data?.truncated ?? false) || (invoicesPortfolioQuery.data?.truncated ?? false);

  const invoiceViews = useMemo(
    () => invoiceRawRows.map((raw, i) => toInvoiceRowView(raw, i)),
    [invoiceRawRows],
  );

  const primaryCollected = useMemo(
    () => sumSavioPaymentsInRange(paymentRows, primaryRange.start, primaryRange.end),
    [paymentRows, primaryRange],
  );
  const primaryExpenses = useMemo(
    () => sumExpensesPaidInRange(expenses, primaryRange.start, primaryRange.end),
    [expenses, primaryRange],
  );
  const primaryInvoiced = useMemo(
    () => sumSavioInvoicedInRange(invoiceRawRows, primaryRange.start, primaryRange.end),
    [invoiceRawRows, primaryRange],
  );

  const compareCollected = useMemo(() => {
    if (!compareRange) return { sum: 0, count: 0 };
    return sumSavioPaymentsInRange(paymentRows, compareRange.start, compareRange.end);
  }, [paymentRows, compareRange]);
  const compareExpenses = useMemo(() => {
    if (!compareRange) return { sum: 0, count: 0 };
    return sumExpensesPaidInRange(expenses, compareRange.start, compareRange.end);
  }, [expenses, compareRange]);
  const compareInvoiced = useMemo(() => {
    if (!compareRange) return { sum: 0, count: 0 };
    return sumSavioInvoicedInRange(invoiceRawRows, compareRange.start, compareRange.end);
  }, [invoiceRawRows, compareRange]);

  const payerRankPrimary = useMemo(
    () => rollupSavioPaymentsByCustomerInRange(paymentRows, primaryRange.start, primaryRange.end),
    [paymentRows, primaryRange],
  );
  const payerRankCompare = useMemo(() => {
    if (!compareRange) return [];
    return rollupSavioPaymentsByCustomerInRange(paymentRows, compareRange.start, compareRange.end);
  }, [paymentRows, compareRange]);

  const portfolio = useMemo(() => portfolioOutstandingFromRows(invoiceRawRows), [invoiceRawRows]);

  const topPrimarySum = useMemo(() => {
    return payerRankPrimary.slice(0, TOP_CLIENTS_FOR_RATIO).reduce((s, r) => s + r.sum, 0);
  }, [payerRankPrimary]);

  const ratios = useMemo(
    () =>
      computeFinanceRatioPack(
        primaryCollected.sum,
        primaryExpenses.sum,
        portfolio.sum,
        topPrimarySum,
      ),
    [primaryCollected.sum, primaryExpenses.sum, portfolio.sum, topPrimarySum],
  );

  const { overdue, upcoming } = useMemo(
    () => buildInvoiceCollectionQueues(invoiceViews, new Date(), 7),
    [invoiceViews],
  );

  const multiServiceClients = useMemo(() => listMultiServiceClients(clients), [clients]);

  const savioError =
    paymentsQuery.data?.lastResult?.ok === false
      ? paymentsQuery.data.lastResult
      : invoicesPortfolioQuery.data?.lastResult?.ok === false
        ? invoicesPortfolioQuery.data.lastResult
        : null;

  const reactQueryError = paymentsQuery.error ?? invoicesPortfolioQuery.error ?? null;

  const isLoading =
    enableSavio && (paymentsQuery.isLoading || invoicesPortfolioQuery.isLoading);

  const canLoadMoreSavioPages =
    truncated &&
    (paymentsMaxPages < MAX_SAVIO_FINANCE_PAGED_CEILING ||
      portfolioMaxPages < MAX_SAVIO_FINANCE_PAGED_CEILING);

  const refetch = useCallback(() => {
    void paymentsQuery.refetch();
    void invoicesPortfolioQuery.refetch();
  }, [paymentsQuery, invoicesPortfolioQuery]);

  return {
    primaryCollected,
    primaryExpenses,
    primaryInvoiced,
    compareCollected,
    compareExpenses,
    compareInvoiced,
    payerRankPrimary,
    payerRankCompare,
    portfolio,
    ratios,
    overdue,
    upcoming,
    multiServiceClients,
    truncated,
    isLoading,
    savioError,
    reactQueryError,
    loadMoreSavioPages,
    canLoadMoreSavioPages,
    refetch,
    savioPagedCaps: { paymentsMaxPages, portfolioMaxPages },
  };
}
