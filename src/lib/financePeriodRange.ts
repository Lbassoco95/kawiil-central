import { getMonthRangeLocal } from "@/lib/financeMonthMetrics";

/** Rango inclusivo en calendario local (mismo criterio que gastos / KPIs). */
export type FinanceLocalDateRange = {
  start: Date;
  end: Date;
};

export type FinancePeriodPreset = "month" | "bimonth" | "quarter" | "semester" | "year" | "custom";

/** Último día del mes (1–12). */
export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Rango del mes calendario que contiene `anchor`. */
export function rangeForCalendarMonthContaining(anchor: Date): FinanceLocalDateRange {
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + 1;
  const { start, end } = getMonthRangeLocal({ year: y, month: m });
  return { start, end };
}

/** Bimestre calendario (ene–feb, mar–abr, …) que contiene `anchor`. */
export function rangeForBimonthContaining(anchor: Date): FinanceLocalDateRange {
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + 1;
  const firstMonth = Math.floor((m - 1) / 2) * 2 + 1;
  const start = new Date(y, firstMonth - 1, 1, 0, 0, 0, 0);
  const lastM = firstMonth + 1;
  const lastD = lastDayOfMonth(y, lastM);
  const end = new Date(y, lastM - 1, lastD, 23, 59, 59, 999);
  return { start, end };
}

/** Trimestre calendario que contiene `anchor`. */
export function rangeForQuarterContaining(anchor: Date): FinanceLocalDateRange {
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + 1;
  const firstMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const start = new Date(y, firstMonth - 1, 1, 0, 0, 0, 0);
  const lastM = firstMonth + 2;
  const lastD = lastDayOfMonth(y, lastM);
  const end = new Date(y, lastM - 1, lastD, 23, 59, 59, 999);
  return { start, end };
}

/** Semestre calendario (ene–jun, jul–dic) que contiene `anchor`. */
export function rangeForSemesterContaining(anchor: Date): FinanceLocalDateRange {
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + 1;
  const firstMonth = m <= 6 ? 1 : 7;
  const start = new Date(y, firstMonth - 1, 1, 0, 0, 0, 0);
  const lastM = firstMonth + 5;
  const lastD = lastDayOfMonth(y, lastM);
  const end = new Date(y, lastM - 1, lastD, 23, 59, 59, 999);
  return { start, end };
}

/** Año calendario que contiene `anchor`. */
export function rangeForYearContaining(anchor: Date): FinanceLocalDateRange {
  const y = anchor.getFullYear();
  const start = new Date(y, 0, 1, 0, 0, 0, 0);
  const end = new Date(y, 11, 31, 23, 59, 59, 999);
  return { start, end };
}

export type ResolveFinanceRangeInput = {
  preset: FinancePeriodPreset;
  /** Fecha de referencia (típicamente “hoy” o mes seleccionado). */
  anchor: Date;
  /** Solo si preset === "custom": inicio y fin locales. */
  custom?: FinanceLocalDateRange | null;
};

export function resolveFinanceRange(input: ResolveFinanceRangeInput): FinanceLocalDateRange {
  const { preset, anchor, custom } = input;
  if (preset === "custom") {
    if (!custom?.start || !custom?.end) {
      return rangeForCalendarMonthContaining(anchor);
    }
    const start =
      custom.start <= custom.end
        ? new Date(
            custom.start.getFullYear(),
            custom.start.getMonth(),
            custom.start.getDate(),
            0,
            0,
            0,
            0,
          )
        : new Date(custom.end.getFullYear(), custom.end.getMonth(), custom.end.getDate(), 0, 0, 0, 0);
    const endRaw = custom.start <= custom.end ? custom.end : custom.start;
    const end = new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate(), 23, 59, 59, 999);
    return { start, end };
  }
  switch (preset) {
    case "month":
      return rangeForCalendarMonthContaining(anchor);
    case "bimonth":
      return rangeForBimonthContaining(anchor);
    case "quarter":
      return rangeForQuarterContaining(anchor);
    case "semester":
      return rangeForSemesterContaining(anchor);
    case "year":
      return rangeForYearContaining(anchor);
    default:
      return rangeForCalendarMonthContaining(anchor);
  }
}

/** Periodo anterior comparable (mismo tipo de corte calendario o misma duración en días para custom). */
export function resolvePreviousComparableRange(
  current: FinanceLocalDateRange,
  preset: FinancePeriodPreset,
): FinanceLocalDateRange {
  if (preset === "custom") {
    const start0 = new Date(
      current.start.getFullYear(),
      current.start.getMonth(),
      current.start.getDate(),
      0,
      0,
      0,
      0,
    );
    const end0 = new Date(current.end.getFullYear(), current.end.getMonth(), current.end.getDate(), 0, 0, 0, 0);
    const days =
      Math.max(
        0,
        Math.round((end0.getTime() - start0.getTime()) / 86_400_000),
      ) + 1;
    const prevEnd = new Date(start0.getTime() - 86_400_000);
    const prevEndDay = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate(), 23, 59, 59, 999);
    const prevStart = new Date(prevEndDay.getTime() - (days - 1) * 86_400_000);
    const prevStartNorm = new Date(
      prevStart.getFullYear(),
      prevStart.getMonth(),
      prevStart.getDate(),
      0,
      0,
      0,
      0,
    );
    return { start: prevStartNorm, end: prevEndDay };
  }

  const anchorPrev = new Date(current.start.getTime() - 86_400_000);
  return resolveFinanceRange({ preset, anchor: anchorPrev });
}

/** Unión de dos rangos (para una sola query Savio). */
export function unionFinanceRanges(a: FinanceLocalDateRange, b: FinanceLocalDateRange | null): FinanceLocalDateRange {
  if (!b) return { ...a };
  const start = a.start <= b.start ? a.start : b.start;
  const end = a.end >= b.end ? a.end : b.end;
  return { start, end };
}
