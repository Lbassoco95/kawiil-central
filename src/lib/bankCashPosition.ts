import type { Expense } from "@/hooks/useExpenses";

export interface BankAccountBalance {
  accountId: string;
  balance: number;
  /** Fecha (YYYY-MM-DD) a la que corresponde el saldo. */
  asOf: string | null;
}

export interface SavingsGoalLike {
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
  archived?: boolean;
}

export interface TxLike {
  tx_date: string;
  amount: number;
}

export interface StatementLike {
  account_id: string;
  period_end: string | null;
  closing_balance: number | null;
  created_at: string;
}

/** Saldo más reciente por cuenta: último estado con saldo final; si no hay, el movimiento más nuevo con saldo. */
export function latestBalances(
  statements: StatementLike[],
  txs: Array<TxLike & { account_id: string; balance: number | null }> = [],
): BankAccountBalance[] {
  const out = new Map<string, BankAccountBalance>();
  const sorted = [...statements]
    .filter((s) => s.closing_balance != null && s.period_end)
    .sort((a, b) => (a.period_end! < b.period_end! ? 1 : a.period_end! > b.period_end! ? -1 : b.created_at.localeCompare(a.created_at)));
  for (const s of sorted) {
    if (!out.has(s.account_id)) {
      out.set(s.account_id, { accountId: s.account_id, balance: Number(s.closing_balance), asOf: s.period_end });
    }
  }
  const fallback = [...txs].filter((t) => t.balance != null).sort((a, b) => b.tx_date.localeCompare(a.tx_date));
  for (const t of fallback) {
    if (!out.has(t.account_id)) {
      out.set(t.account_id, { accountId: t.account_id, balance: Number(t.balance), asOf: t.tx_date });
    }
  }
  return [...out.values()];
}

/**
 * Comprometido = lo que el despacho ya debe pagar: gastos aprobados por pagar +
 * reembolsos pendientes a trabajadores (sin contar dos veces el mismo gasto).
 * "Por aprobar" se muestra aparte: todavía no es un compromiso firme.
 */
export function commitments(expenses: Expense[]) {
  const firm = new Map<string, number>();
  let tentative = 0;
  let tentativeCount = 0;
  for (const e of expenses) {
    const amount = Number(e.amount) || 0;
    if (e.status === "rechazado") continue;
    if (e.status === "aprobado") firm.set(e.id, amount);
    else if (
      e.reimbursement_type === "reembolsar_trabajador" &&
      e.reimbursement_status === "pendiente"
    ) {
      firm.set(e.id, amount);
    } else if (e.status === "solicitado" || e.status === "en_revision") {
      tentative += amount;
      tentativeCount++;
    }
  }
  let firmSum = 0;
  firm.forEach((v) => (firmSum += v));
  return { firm: firmSum, firmCount: firm.size, tentative, tentativeCount };
}

/** Meses completos (mínimo 1) entre hoy y la fecha meta. */
export function monthsUntil(target: string | null, now = new Date()): number | null {
  if (!target) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(target);
  if (!m) return null;
  const diff = (+m[1] - now.getFullYear()) * 12 + (+m[2] - 1 - now.getMonth());
  return Math.max(1, diff);
}

export function goalMonthlyNeed(g: SavingsGoalLike, now = new Date()): number {
  const remaining = Math.max(0, Number(g.target_amount) - Number(g.saved_amount));
  const months = monthsUntil(g.target_date, now);
  if (!months || remaining === 0) return 0;
  return Math.ceil((remaining / months) * 100) / 100;
}

export function savingsSummary(goals: SavingsGoalLike[], now = new Date()) {
  const active = goals.filter((g) => !g.archived);
  return {
    saved: active.reduce((s, g) => s + Number(g.saved_amount), 0),
    monthlyNeed: active.reduce((s, g) => s + goalMonthlyNeed(g, now), 0),
  };
}

export function cashPosition(args: {
  balances: BankAccountBalance[];
  expenses: Expense[];
  goals: SavingsGoalLike[];
  now?: Date;
}) {
  const banks = args.balances.reduce((s, b) => s + b.balance, 0);
  const c = commitments(args.expenses);
  const sv = savingsSummary(args.goals, args.now);
  return {
    banks,
    committed: c.firm,
    committedCount: c.firmCount,
    tentative: c.tentative,
    tentativeCount: c.tentativeCount,
    saved: sv.saved,
    monthlySavingsNeed: sv.monthlyNeed,
    /** Lo que realmente se puede usar hoy: bancos − comprometido − lo ya apartado para ahorro. */
    free: banks - c.firm - sv.saved,
  };
}

/** Entradas/salidas/neto por mes de los últimos `months` meses (incluye el actual). */
export function monthlyFlow(txs: TxLike[], months = 6, now = new Date()) {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const map = new Map(keys.map((k) => [k, { month: k, inflow: 0, outflow: 0, net: 0 }]));
  for (const t of txs) {
    const row = map.get(t.tx_date.slice(0, 7));
    if (!row) continue;
    const a = Number(t.amount);
    if (a >= 0) row.inflow += a;
    else row.outflow += -a;
    row.net += a;
  }
  return keys.map((k) => map.get(k)!);
}

/** Promedio mensual de gasto/entrada de los meses con movimientos (excluye el mes en curso si es parcial). */
export function runwayMonths(banks: number, flow: ReturnType<typeof monthlyFlow>): number | null {
  const complete = flow.slice(0, -1).filter((m) => m.outflow > 0);
  if (complete.length === 0) return null;
  const avgOut = complete.reduce((s, m) => s + m.outflow, 0) / complete.length;
  const avgIn = complete.reduce((s, m) => s + m.inflow, 0) / complete.length;
  const burn = avgOut - avgIn;
  if (burn <= 0) return null; // entra más de lo que sale
  return Math.max(0, banks) / burn;
}
