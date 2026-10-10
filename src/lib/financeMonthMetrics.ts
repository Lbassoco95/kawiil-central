import type { Expense } from "@/hooks/useExpenses";
import { pickSavioNumber, pickSavioString } from "@/lib/savioApiNormalize";

/**
 * Límite de navegación en el resumen financiero: el usuario no puede ir más de N meses
 * antes del mes calendario actual (ver plan Finanzas).
 */
export const FINANCE_DASHBOARD_MONTH_LOOKBACK = 24;

/** Mes calendario (1–12). */
export type YearMonth = { year: number; month: number };

export function yearMonthFromDate(d: Date): YearMonth {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function yearMonthKey(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

export function parseYearMonthKey(key: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Inicio (00:00:00.000) y fin (23:59:59.999) del mes en **zona horaria local del navegador**
 * (`Date` con constructor local). Todas las comparaciones mensuales de gastos y KPIs del
 * dashboard usan este mismo criterio para ser coherentes con lo que ve el usuario.
 */
export function getMonthRangeLocal(ym: YearMonth): { start: Date; end: Date } {
  const start = new Date(ym.year, ym.month - 1, 1, 0, 0, 0, 0);
  const end = new Date(ym.year, ym.month, 0, 23, 59, 59, 999);
  return { start, end };
}

/** Primer instante del mes N meses antes de `anchor` (mismo día anchor no usado; solo mes/año). */
export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const d = new Date(ym.year, ym.month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function parseSavioDateString(s: string | null | undefined): Date | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (isoDay) {
    const y = Number(isoDay[1]);
    const mo = Number(isoDay[2]);
    const day = Number(isoDay[3]);
    return new Date(y, mo - 1, day);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateInLocalMonth(d: Date, ym: YearMonth): boolean {
  const { start, end } = getMonthRangeLocal(ym);
  return d >= start && d <= end;
}

/** Inclusivo: `start` y `end` típicamente 00:00 y 23:59:59 locales. */
export function dateInLocalRange(d: Date, start: Date, end: Date): boolean {
  return d >= start && d <= end;
}

/** Gastos pagados en el mes (local): `paid_at` si existe, si no `expense_date`. */
export function sumExpensesPaidInMonth(expenses: Expense[], ym: YearMonth): { sum: number; count: number } {
  const { start, end } = getMonthRangeLocal(ym);
  let sum = 0;
  let count = 0;
  for (const e of expenses) {
    if (e.status !== "pagado") continue;
    const raw = e.paid_at?.trim() ? e.paid_at : e.expense_date;
    const d = parseSavioDateString(raw) ?? (raw ? new Date(raw) : null);
    if (!d || Number.isNaN(d.getTime())) continue;
    if (d < start || d > end) continue;
    sum += Number(e.amount);
    count += 1;
  }
  return { sum, count };
}

export function sumExpensesPaidInRange(
  expenses: Expense[],
  start: Date,
  end: Date,
): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const e of expenses) {
    if (e.status !== "pagado") continue;
    const raw = e.paid_at?.trim() ? e.paid_at : e.expense_date;
    const d = parseSavioDateString(raw) ?? (raw ? new Date(raw) : null);
    if (!d || Number.isNaN(d.getTime())) continue;
    if (!dateInLocalRange(d, start, end)) continue;
    sum += Number(e.amount);
    count += 1;
  }
  return { sum, count };
}

/** Suma `amount_paid` con `payment_date` en el mes (interpretado en calendario local). */
export function sumSavioPaymentsInMonth(paymentRows: unknown[], ym: YearMonth): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const row of paymentRows) {
    const payDate = pickSavioString(row, ["payment_date", "paymentDate"]);
    const d = parseSavioDateString(payDate === "—" ? null : payDate);
    if (!d || !dateInLocalMonth(d, ym)) continue;
    const amt = pickSavioNumber(row, ["amount_paid", "amount", "total", "paid_amount"]);
    if (amt !== null) {
      sum += amt;
      count += 1;
    }
  }
  return { sum, count };
}

export function sumSavioPaymentsInRange(
  paymentRows: unknown[],
  start: Date,
  end: Date,
): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const row of paymentRows) {
    const payDate = pickSavioString(row, ["payment_date", "paymentDate"]);
    const d = parseSavioDateString(payDate === "—" ? null : payDate);
    if (!d || !dateInLocalRange(d, start, end)) continue;
    const amt = pickSavioNumber(row, ["amount_paid", "amount", "total", "paid_amount"]);
    if (amt !== null) {
      sum += amt;
      count += 1;
    }
  }
  return { sum, count };
}

/** Cartera: facturas `valid` con `amount_remaining`. */
export function sumSavioOutstandingValid(invoiceRows: unknown[]): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const row of invoiceRows) {
    const st = pickSavioString(row, ["status", "estado", "state"]).toLowerCase();
    if (st !== "valid") continue;
    const rem = pickSavioNumber(row, ["amount_remaining", "balance", "amount_due"]);
    if (rem === null || rem <= 0) continue;
    sum += rem;
    count += 1;
  }
  return { sum, count };
}

/**
 * Facturado / cargos del mes: suma `amount_total` con `invoice_date` en el mes (local).
 * Excluye `void`; el resto de estados cuenta como emitido en ese mes (criterio del plan).
 */
export function sumSavioInvoicedInMonth(invoiceRows: unknown[], ym: YearMonth): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const row of invoiceRows) {
    const st = pickSavioString(row, ["status", "estado", "state"]).toLowerCase();
    if (st === "void") continue;
    const invDateStr = pickSavioString(row, ["invoice_date", "invoiceDate", "created_at"]);
    const d = parseSavioDateString(invDateStr === "—" ? null : invDateStr);
    if (!d || !dateInLocalMonth(d, ym)) continue;
    const amt = pickSavioNumber(row, ["amount_total", "total", "total_amount", "amount"]);
    if (amt !== null) {
      sum += amt;
      count += 1;
    }
  }
  return { sum, count };
}

export function sumSavioInvoicedInRange(
  invoiceRows: unknown[],
  start: Date,
  end: Date,
): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const row of invoiceRows) {
    const st = pickSavioString(row, ["status", "estado", "state"]).toLowerCase();
    if (st === "void") continue;
    const invDateStr = pickSavioString(row, ["invoice_date", "invoiceDate", "created_at"]);
    const d = parseSavioDateString(invDateStr === "—" ? null : invDateStr);
    if (!d || !dateInLocalRange(d, start, end)) continue;
    const amt = pickSavioNumber(row, ["amount_total", "total", "total_amount", "amount"]);
    if (amt !== null) {
      sum += amt;
      count += 1;
    }
  }
  return { sum, count };
}

/** Nombres de campo de cursor "siguiente" que Savio podría usar (varias convenciones). */
const SAVIO_CURSOR_KEYS = ["nextCursor", "next_cursor", "nextPageCursor", "next_page_cursor", "cursor"];
/** Sub-objetos donde suele venir anidada la paginación. */
const SAVIO_PAGING_CONTAINERS = ["paging", "pagination", "meta", "page_info", "pageInfo"];

function readCursorFrom(obj: Record<string, unknown>): string | null {
  for (const k of SAVIO_CURSOR_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Extrae el cursor de la siguiente página de una respuesta Savio.
 * Reconoce varias convenciones de nombre (camelCase/snake_case) y contenedores
 * anidados (paging/pagination/meta). Aditivo: si no hay cursor reconocible
 * devuelve null y la paginación se detiene, como antes.
 */
export function extractSavioNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const direct = readCursorFrom(root);
  if (direct) return direct;
  for (const container of SAVIO_PAGING_CONTAINERS) {
    const nested = root[container];
    if (nested && typeof nested === "object") {
      const c = readCursorFrom(nested as Record<string, unknown>);
      if (c) return c;
    }
  }
  return null;
}

/** Últimos `count` meses terminando en `endYm` (inclusive), orden cronológico ascendente. */
export function lastNYearMonths(endYm: YearMonth, count: number): YearMonth[] {
  const out: YearMonth[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(addMonths(endYm, -i));
  }
  return out;
}
