import type { Expense } from "@/hooks/useExpenses";
import {
  type RecurringExpense,
  type RecurringFrequency,
  FREQUENCY_PER_YEAR,
  monthlyEquivalent,
} from "@/hooks/useRecurringExpenses";

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  terceros: "Terceros / cliente",
  viaticos: "Viáticos",
  operativo: "Operativo interno",
  contratacion_externa: "Contratación externa",
  otro: "Otro",
};

/** ¿La plantilla recurrente aplica (está viva) en el mes YYYY-MM dado? */
export function recurringActiveInMonth(r: RecurringExpense, ym: string): boolean {
  if (!r.active) return false;
  const monthStart = `${ym}-01`;
  // Fin de mes (último día): construimos el primer día del mes siguiente menos 1.
  const [y, m] = ym.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  if (r.start_date && r.start_date >= nextMonth) return false;
  if (r.end_date && r.end_date < monthStart) return false;
  return true;
}

/**
 * ¿Cuánto se espera pagar de esta plantilla EN el mes indicado?
 * - mensual/quincenal/semanal: su equivalente mensual.
 * - bimestral/trimestral/…: solo cae en los meses múltiplo desde start_date.
 */
export function expectedAmountInMonth(r: RecurringExpense, ym: string): number {
  if (!recurringActiveInMonth(r, ym)) return 0;
  const amount = Number(r.amount) || 0;
  switch (r.frequency) {
    case "mensual":
      return amount;
    case "quincenal":
      return amount * 2;
    case "semanal":
      return amount * 4.33;
    default: {
      // Frecuencias plurimensuales: distribuir según su cadencia desde start_date.
      const step = 12 / (FREQUENCY_PER_YEAR[r.frequency as RecurringFrequency] ?? 1);
      const [sy, sm] = (r.start_date || `${ym}-01`).split("-").map(Number);
      const [ty, tm] = ym.split("-").map(Number);
      const monthsDiff = (ty - sy) * 12 + (tm - sm);
      if (monthsDiff < 0) return 0;
      return monthsDiff % step === 0 ? amount : 0;
    }
  }
}

export interface PlanningTotals {
  /** Compromiso esperado del mes (suma de plantillas que caen en el mes). */
  expectedMonth: number;
  /** Compromiso mensual promedio anualizado (todas las plantillas activas). */
  monthlyAverage: number;
  /** Compromiso anual total. */
  annual: number;
  /** Gasto real registrado en el mes (aprobado + pagado). */
  actualMonth: number;
  /** Gasto ya pagado en el mes. */
  paidMonth: number;
  byCategory: Array<{ category: string; label: string; expected: number; actual: number }>;
  activeCount: number;
}

function ymOf(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  return dateStr.slice(0, 7);
}

/** Consolida planeado (recurrentes) vs real (expenses) para un mes YYYY-MM. */
export function computePlanningTotals(
  recurring: RecurringExpense[],
  expenses: Expense[],
  ym: string,
): PlanningTotals {
  const active = recurring.filter((r) => r.active);
  const monthlyAverage = active
    .filter((r) => recurringActiveInMonth(r, ym))
    .reduce((s, r) => s + monthlyEquivalent(r), 0);
  const annual = monthlyAverage * 12;
  const expectedMonth = active.reduce((s, r) => s + expectedAmountInMonth(r, ym), 0);

  const monthExpenses = expenses.filter((e) => ymOf(e.expense_date) === ym);
  const counted = monthExpenses.filter((e) => ["aprobado", "pagado"].includes(e.status));
  const actualMonth = counted.reduce((s, e) => s + Number(e.amount), 0);
  const paidMonth = monthExpenses
    .filter((e) => e.status === "pagado")
    .reduce((s, e) => s + Number(e.amount), 0);

  const cats = new Map<string, { expected: number; actual: number }>();
  const bump = (cat: string, key: "expected" | "actual", val: number) => {
    const c = cats.get(cat) ?? { expected: 0, actual: 0 };
    c[key] += val;
    cats.set(cat, c);
  };
  active.forEach((r) => bump(r.category, "expected", expectedAmountInMonth(r, ym)));
  counted.forEach((e) => bump(e.category, "actual", Number(e.amount)));

  const byCategory = Array.from(cats.entries())
    .map(([category, v]) => ({
      category,
      label: EXPENSE_CATEGORY_LABELS[category] ?? category,
      expected: v.expected,
      actual: v.actual,
    }))
    .filter((c) => c.expected > 0 || c.actual > 0)
    .sort((a, b) => Math.max(b.expected, b.actual) - Math.max(a.expected, a.actual));

  return {
    expectedMonth,
    monthlyAverage,
    annual,
    actualMonth,
    paidMonth,
    byCategory,
    activeCount: active.length,
  };
}

/** Próximos pagos recurrentes esperados (por día del mes) dentro del mes. */
export function upcomingRecurring(
  recurring: RecurringExpense[],
  ym: string,
): Array<{ recurring: RecurringExpense; expected: number; day: number | null }> {
  return recurring
    .filter((r) => r.active && expectedAmountInMonth(r, ym) > 0)
    .map((r) => ({ recurring: r, expected: expectedAmountInMonth(r, ym), day: r.day_of_month }))
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
}

export interface GroupCompanyReceivable {
  group_company_id: string;
  count: number;
  amount: number;
}

/** Cuentas por cobrar a empresas del grupo: gastos con cobro pendiente. */
export function groupCompanyReceivables(expenses: Expense[]): {
  total: number;
  count: number;
  byCompany: GroupCompanyReceivable[];
} {
  const pending = expenses.filter(
    (e) =>
      e.reimbursement_type === "cobrar_empresa_grupo" &&
      e.reimbursement_status === "pendiente" &&
      e.status !== "rechazado",
  );
  const map = new Map<string, GroupCompanyReceivable>();
  for (const e of pending) {
    const key = e.group_company_id ?? "sin_empresa";
    const cur = map.get(key) ?? { group_company_id: key, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number(e.amount);
    map.set(key, cur);
  }
  return {
    total: pending.reduce((s, e) => s + Number(e.amount), 0),
    count: pending.length,
    byCompany: Array.from(map.values()).sort((a, b) => b.amount - a.amount),
  };
}
