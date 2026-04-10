import { extractSavioList } from "@/lib/savioApiNormalize";
import { extractSavioNextCursor } from "@/lib/financeMonthMetrics";
import { fetchSavioResource, type SavioFinanceApiAction } from "@/lib/savioFinanceInvoke";

const DEFAULT_MAX_PAGES = 10;
const PAGE_LIMIT = "100";

export type SavioPagedFetchResult = {
  rows: unknown[];
  truncated: boolean;
  lastResult: Awaited<ReturnType<typeof fetchSavioResource>>;
};

async function fetchAllPages(
  action: SavioFinanceApiAction,
  baseQuery: Record<string, string>,
  maxPages = DEFAULT_MAX_PAGES,
): Promise<SavioPagedFetchResult> {
  const rows: unknown[] = [];
  let cursor: string | undefined;
  let lastResult: Awaited<ReturnType<typeof fetchSavioResource>> = {};
  let lastNext: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const query: Record<string, string> = {
      ...baseQuery,
      limit: PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    };
    lastResult = await fetchSavioResource(action, query);
    if (lastResult.ok !== true) break;

    const payload = lastResult.data;
    rows.push(...extractSavioList(payload));
    lastNext = extractSavioNextCursor(payload);
    if (!lastNext) break;
    cursor = lastNext;
  }

  const truncated = lastNext !== null;
  return { rows, truncated, lastResult };
}

/**
 * Rango ISO para la query Savio. En OpenAPI suele filtrar por **actualización** del registro,
 * no por `payment_date` / `invoice_date`; el dashboard aplica esas fechas en cliente.
 */
export function buildIsoRangeForSavioQuery(start: Date, end: Date): { start_date: string; end_date: string } {
  return {
    start_date: start.toISOString(),
    end_date: end.toISOString(),
  };
}

export async function fetchSavioPaymentsWindow(
  start: Date,
  end: Date,
  maxPages?: number,
): Promise<SavioPagedFetchResult> {
  const { start_date, end_date } = buildIsoRangeForSavioQuery(start, end);
  return fetchAllPages("payments", { start_date, end_date }, maxPages);
}

export async function fetchSavioInvoicesWindow(
  start: Date,
  end: Date,
  maxPages?: number,
): Promise<SavioPagedFetchResult> {
  const { start_date, end_date } = buildIsoRangeForSavioQuery(start, end);
  return fetchAllPages("invoices", { start_date, end_date }, maxPages);
}

/** Cartera: ventana amplia de actualizaciones + paginación (heurística; Savio filtra por updated_at). */
export async function fetchSavioInvoicesForPortfolio(
  lookbackStart: Date,
  end: Date,
  maxPages?: number,
): Promise<SavioPagedFetchResult> {
  return fetchSavioInvoicesWindow(lookbackStart, end, maxPages);
}
