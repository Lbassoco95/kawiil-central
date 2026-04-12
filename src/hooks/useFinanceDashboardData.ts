import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { Expense } from "@/hooks/useExpenses";
import {
  addMonths,
  getMonthRangeLocal,
  lastNYearMonths,
  sumExpensesPaidInMonth,
  sumSavioInvoicedInMonth,
  sumSavioOutstandingValid,
  sumSavioPaymentsInMonth,
  yearMonthFromDate,
  yearMonthKey,
  type YearMonth,
} from "@/lib/financeMonthMetrics";
import { pickSavioString } from "@/lib/savioApiNormalize";
import {
  fetchSavioInvoicesWindow,
  fetchSavioPaymentsWindow,
  getSavioFinancePagedMaxPages,
  getSavioFinancePortfolioPagedMaxPages,
  MAX_SAVIO_FINANCE_PAGED_CEILING,
  SAVIO_FINANCE_PAGE_BOOST_STEP,
} from "@/lib/savioFinancePagedFetch";

function ymCompare(a: YearMonth, b: YearMonth): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function mergePaymentRows(a: unknown[], b: unknown[]): unknown[] {
  if (b.length === 0) return a;
  const map = new Map<string, unknown>();
  const keyOf = (r: unknown) => {
    const id = pickSavioString(r, ["payment_id", "id", "uuid"]);
    return id !== "—" ? `id:${id}` : `h:${JSON.stringify(r).slice(0, 80)}`;
  };
  for (const r of a) map.set(keyOf(r), r);
  for (const r of b) map.set(keyOf(r), r);
  return [...map.values()];
}

export function useFinanceDashboardData(
  selectedYm: YearMonth,
  expenses: Expense[],
  options: { enableSavio: boolean },
) {
  const { user } = useAuth();
  const enableSavio = options.enableSavio && !!user;

  const basePaymentsMaxPages = getSavioFinancePagedMaxPages();
  const basePortfolioMaxPages = getSavioFinancePortfolioPagedMaxPages();
  const [pagedFetchBoost, setPagedFetchBoost] = useState(0);
  const paymentsMaxPages = Math.min(basePaymentsMaxPages + pagedFetchBoost, MAX_SAVIO_FINANCE_PAGED_CEILING);
  const portfolioMaxPages = Math.min(basePortfolioMaxPages + pagedFetchBoost, MAX_SAVIO_FINANCE_PAGED_CEILING);

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

  const cy = new Date().getFullYear();
  const cm = new Date().getMonth() + 1;
  const currentYm = useMemo((): YearMonth => ({ year: cy, month: cm }), [cy, cm]);
  const trendStartYm = useMemo(() => addMonths(currentYm, -11), [currentYm]);
  const trendRange = useMemo(() => {
    const start = getMonthRangeLocal(trendStartYm).start;
    const end = getMonthRangeLocal(currentYm).end;
    return { start, end };
  }, [currentYm, trendStartYm]);

  const needsPastPayments = ymCompare(selectedYm, trendStartYm) < 0;

  const pastRange = useMemo(() => getMonthRangeLocal(selectedYm), [selectedYm]);

  const portfolioRange = useMemo(() => {
    const start = getMonthRangeLocal(addMonths(currentYm, -48)).start;
    const end = getMonthRangeLocal(currentYm).end;
    return { start, end };
  }, [currentYm]);

  const paymentsWideQuery = useQuery({
    queryKey: [
      "finance-dashboard",
      "savio-payments-wide",
      user?.id,
      trendRange.start.toISOString(),
      trendRange.end.toISOString(),
      paymentsMaxPages,
    ],
    queryFn: () => fetchSavioPaymentsWindow(trendRange.start, trendRange.end, paymentsMaxPages),
    enabled: enableSavio,
    staleTime: 60_000,
  });

  const paymentsPastQuery = useQuery({
    queryKey: [
      "finance-dashboard",
      "savio-payments-past",
      user?.id,
      yearMonthKey(selectedYm),
      paymentsMaxPages,
    ],
    queryFn: () => fetchSavioPaymentsWindow(pastRange.start, pastRange.end, paymentsMaxPages),
    enabled: enableSavio && needsPastPayments,
    staleTime: 60_000,
  });

  const invoicesPortfolioQuery = useQuery({
    queryKey: [
      "finance-dashboard",
      "savio-invoices-portfolio",
      user?.id,
      portfolioRange.start.toISOString(),
      portfolioRange.end.toISOString(),
      portfolioMaxPages,
    ],
    queryFn: () => fetchSavioInvoicesWindow(portfolioRange.start, portfolioRange.end, portfolioMaxPages),
    enabled: enableSavio,
    staleTime: 60_000,
  });

  const paymentRows = useMemo(() => {
    const wide = paymentsWideQuery.data?.rows ?? [];
    if (!needsPastPayments) return wide;
    const past = paymentsPastQuery.data?.rows ?? [];
    return mergePaymentRows(wide, past);
  }, [paymentsWideQuery.data, paymentsPastQuery.data, needsPastPayments]);

  const invoiceRows = useMemo(
    () => invoicesPortfolioQuery.data?.rows ?? [],
    [invoicesPortfolioQuery.data],
  );

  const truncated =
    (paymentsWideQuery.data?.truncated ?? false) ||
    (paymentsPastQuery.data?.truncated ?? false) ||
    (invoicesPortfolioQuery.data?.truncated ?? false);

  const kpis = useMemo(() => {
    const cobradoMes = enableSavio
      ? sumSavioPaymentsInMonth(paymentRows, selectedYm)
      : { sum: 0, count: 0 };
    const gastosMes = sumExpensesPaidInMonth(expenses, selectedYm);
    const cartera = enableSavio ? sumSavioOutstandingValid(invoiceRows) : { sum: 0, count: 0 };
    const facturadoMes = enableSavio
      ? sumSavioInvoicedInMonth(invoiceRows, selectedYm)
      : { sum: 0, count: 0 };
    return { cobradoMes, gastosMes, cartera, facturadoMes };
  }, [enableSavio, paymentRows, invoiceRows, expenses, selectedYm]);

  const trendMonths = useMemo(() => lastNYearMonths(currentYm, 12), [currentYm]);

  const trendBars = useMemo(() => {
    const wideRows = paymentsWideQuery.data?.rows ?? [];
    return trendMonths.map((ym) => {
      const ingresos = enableSavio ? sumSavioPaymentsInMonth(wideRows, ym).sum : 0;
      const gastos = sumExpensesPaidInMonth(expenses, ym).sum;
      return {
        key: yearMonthKey(ym),
        ingresos,
        gastos,
      };
    });
  }, [trendMonths, paymentsWideQuery.data, expenses, enableSavio]);

  const isLoading =
    enableSavio &&
    (paymentsWideQuery.isLoading || (needsPastPayments && paymentsPastQuery.isLoading) || invoicesPortfolioQuery.isLoading);

  const savioError =
    paymentsWideQuery.data?.lastResult?.ok === false
      ? paymentsWideQuery.data.lastResult
      : paymentsPastQuery.data?.lastResult?.ok === false
        ? paymentsPastQuery.data.lastResult
        : invoicesPortfolioQuery.data?.lastResult?.ok === false
          ? invoicesPortfolioQuery.data.lastResult
          : null;

  const reactQueryError =
    paymentsWideQuery.error ?? paymentsPastQuery.error ?? invoicesPortfolioQuery.error ?? null;

  const canLoadMoreSavioPages =
    truncated &&
    (paymentsMaxPages < MAX_SAVIO_FINANCE_PAGED_CEILING ||
      portfolioMaxPages < MAX_SAVIO_FINANCE_PAGED_CEILING);

  return {
    kpis,
    trendBars,
    trendMonths,
    currentYm,
    truncated,
    isLoading,
    savioError,
    reactQueryError,
    invoiceRows: enableSavio ? invoiceRows : [],
    refetch: () => {
      void paymentsWideQuery.refetch();
      void invoicesPortfolioQuery.refetch();
      if (needsPastPayments) void paymentsPastQuery.refetch();
    },
    loadMoreSavioPages,
    canLoadMoreSavioPages,
    savioPagedCaps: { paymentsMaxPages, portfolioMaxPages },
  };
}
