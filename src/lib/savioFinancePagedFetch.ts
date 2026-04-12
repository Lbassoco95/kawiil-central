import { extractSavioList } from "@/lib/savioApiNormalize";
import { extractSavioNextCursor } from "@/lib/financeMonthMetrics";
import { fetchSavioResource, type SavioFinanceApiAction } from "@/lib/savioFinanceInvoke";

/** Techo de seguridad para no saturar el navegador con demasiadas páginas Savio. */
export const MAX_SAVIO_FINANCE_PAGED_CEILING = 50;

/** Cuántas páginas extra (por ventana) suma cada clic en «Cargar más» en el resumen financiero. */
export const SAVIO_FINANCE_PAGE_BOOST_STEP = 15;

const FALLBACK_MAX_PAGES = 10;
const PAGE_LIMIT = "100";

function parseMaxPagesEnv(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_SAVIO_FINANCE_PAGED_CEILING);
}

/** Páginas máx. por ventana de pagos/facturas en dashboard (env `VITE_SAVIO_FINANCE_MAX_PAGES`, default 10). */
export function getSavioFinancePagedMaxPages(): number {
  return parseMaxPagesEnv(
    import.meta.env.VITE_SAVIO_FINANCE_MAX_PAGES as string | undefined,
    FALLBACK_MAX_PAGES,
  );
}

/**
 * Páginas máx. para la query de cartera (facturas, ventana larga).
 * `VITE_SAVIO_FINANCE_PORTFOLIO_MAX_PAGES` o, si no existe, el doble del tope general (sin superar el techo).
 */
export function getSavioFinancePortfolioPagedMaxPages(): number {
  const raw = import.meta.env.VITE_SAVIO_FINANCE_PORTFOLIO_MAX_PAGES as string | undefined;
  if (raw !== undefined && String(raw).trim() !== "") {
    return parseMaxPagesEnv(raw, Math.min(getSavioFinancePagedMaxPages() * 2, MAX_SAVIO_FINANCE_PAGED_CEILING));
  }
  const base = getSavioFinancePagedMaxPages();
  return Math.min(base * 2, MAX_SAVIO_FINANCE_PAGED_CEILING);
}

export type SavioPagedFetchResult = {
  rows: unknown[];
  truncated: boolean;
  lastResult: Awaited<ReturnType<typeof fetchSavioResource>>;
};

async function fetchAllPages(
  action: SavioFinanceApiAction,
  baseQuery: Record<string, string>,
  maxPages = FALLBACK_MAX_PAGES,
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
