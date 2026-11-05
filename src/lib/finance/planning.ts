export interface FlowMovement {
  movement_date: string; debit: number; credit: number; excluded_from_flow: boolean;
}

export interface MonthFlow { key: string; income: number; expense: number; net: number }

export const ymKey = (iso: string) => iso.slice(0, 7);

/** Flujo operativo mensual (sin traspasos internos ni dinero de terceros). */
export function monthlyFlow(movements: FlowMovement[]): MonthFlow[] {
  const map = new Map<string, MonthFlow>();
  for (const m of movements) {
    if (m.excluded_from_flow) continue;
    const key = ymKey(m.movement_date);
    const f = map.get(key) ?? { key, income: 0, expense: 0, net: 0 };
    f.income += Number(m.credit); f.expense += Number(m.debit);
    map.set(key, f);
  }
  const out = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  out.forEach((f) => { f.net = f.income - f.expense; });
  return out;
}

export interface AccountBalanceInput {
  id: string; opening_balance: number; counts_as_available: boolean; parent_account_id?: string | null;
}

export interface BalanceMovement {
  account_id: string; debit: number; credit: number; movement_date: string;
  row_seq?: number | null; reported_balance?: number | null;
}

export interface BalanceResult {
  byAccount: Record<string, number>;
  /** Saldo solo sumando movimientos (para detectar movimientos faltantes en el estado de cuenta). */
  computed: Record<string, number>;
  /** Cuentas donde se usó el último saldo reportado por el banco como ancla. */
  anchored: Record<string, boolean>;
  available: number;
  held: number;
}

/**
 * Saldo por cuenta. Si el Excel trae el saldo que reporta el banco, se ancla al último renglón
 * con saldo y se suman solo los movimientos posteriores (pegados o manuales). Si no, saldo inicial + abonos − cargos.
 */
export function accountBalances(accounts: AccountBalanceInput[], movements: BalanceMovement[]): BalanceResult {
  const byAccount: Record<string, number> = {};
  const computed: Record<string, number> = {};
  const anchored: Record<string, boolean> = {};
  const groups: Record<string, BalanceMovement[]> = {};
  for (const m of movements) (groups[m.account_id] ??= []).push(m);
  for (const a of accounts) {
    const ms = groups[a.id] ?? [];
    computed[a.id] = Number(a.opening_balance) + ms.reduce((s, m) => s + Number(m.credit) - Number(m.debit), 0);
    let anchor: BalanceMovement | null = null;
    for (const m of ms) {
      if (m.reported_balance == null || m.row_seq == null) continue;
      if (!anchor || m.movement_date > anchor.movement_date || (m.movement_date === anchor.movement_date && m.row_seq > (anchor.row_seq ?? -1))) anchor = m;
    }
    if (anchor) {
      const after = ms.filter((m) => m.movement_date > anchor!.movement_date || (m.movement_date === anchor!.movement_date && (m.row_seq == null || m.row_seq > anchor!.row_seq!)));
      byAccount[a.id] = Number(anchor.reported_balance) + after.reduce((s, m) => s + Number(m.credit) - Number(m.debit), 0);
      anchored[a.id] = true;
    } else {
      byAccount[a.id] = computed[a.id]; anchored[a.id] = false;
    }
  }
  // Un sub-libro (hoja de terceros) vive dentro de su cuenta padre: se resta del padre y se cuenta como retenido.
  const childTotal: Record<string, number> = {};
  for (const a of accounts) if (a.parent_account_id) childTotal[a.parent_account_id] = (childTotal[a.parent_account_id] ?? 0) + byAccount[a.id];
  let available = 0; let held = 0;
  for (const a of accounts) {
    if (a.counts_as_available) available += byAccount[a.id] - (childTotal[a.id] ?? 0);
    else held += byAccount[a.id];
  }
  return { byAccount, computed, anchored, available, held };
}

export interface PipelineLead { estimated_value: number | null; stageProbability: number }

/** Probabilidad por etapa según su posición (las etapas finales pesan más). Ganado = 1, perdido = 0. */
export function stageProbabilities(
  stages: { id: string; slug: string; position: number; is_terminal: boolean }[],
): Record<string, number> {
  const open = stages.filter((s) => !s.is_terminal).sort((a, b) => a.position - b.position);
  const out: Record<string, number> = {};
  open.forEach((s, i) => { out[s.id] = open.length <= 1 ? 0.5 : 0.1 + (0.7 * i) / (open.length - 1); });
  for (const s of stages) {
    if (!s.is_terminal) continue;
    out[s.id] = s.slug === "perdido" || s.slug === "frio" ? 0 : 1;
  }
  return out;
}

export const addMonthsKey = (key: string, n: number): string => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export interface ProjectionInput {
  history: MonthFlow[];          // meses completos previos
  startKey: string;              // primer mes proyectado
  months: number;
  baseIncome: number;            // run-rate de ingresos
  baseExpense: number;           // run-rate de gastos
  newClientsPerMonth: number;
  avgNewClientMonthly: number;   // mensualidad promedio por cliente nuevo
  pipelineWeighted: number;      // valor ponderado del pipeline abierto
  pipelineIsMonthly: boolean;    // valor del lead = mensualidad (true) o pago único (false)
  pipelineMonthsToClose: number; // en cuántos meses se materializa el pipeline
  openingCash: number;
  incomeTargets?: Record<string, number>;
}

export interface ProjectionMonth {
  key: string; income: number; expense: number; net: number; cash: number; target: number | null;
}

export function runRate(history: MonthFlow[], months = 3): { income: number; expense: number } {
  const last = history.slice(-months);
  if (last.length === 0) return { income: 0, expense: 0 };
  return {
    income: last.reduce((s, f) => s + f.income, 0) / last.length,
    expense: last.reduce((s, f) => s + f.expense, 0) / last.length,
  };
}

export function project(inp: ProjectionInput): ProjectionMonth[] {
  const out: ProjectionMonth[] = [];
  let cash = inp.openingCash;
  const perMonthPipeline = inp.pipelineWeighted / Math.max(1, inp.pipelineMonthsToClose);
  for (let i = 0; i < inp.months; i++) {
    const key = addMonthsKey(inp.startKey, i);
    const newRecurring = inp.newClientsPerMonth * inp.avgNewClientMonthly * i;
    let pipelineIncome = 0;
    if (i < inp.pipelineMonthsToClose) {
      pipelineIncome = inp.pipelineIsMonthly ? 0 : perMonthPipeline;
    }
    if (inp.pipelineIsMonthly) {
      const closedShare = Math.min(i + 1, inp.pipelineMonthsToClose) / Math.max(1, inp.pipelineMonthsToClose);
      pipelineIncome = inp.pipelineWeighted * closedShare;
    }
    const income = inp.baseIncome + newRecurring + pipelineIncome;
    const expense = inp.baseExpense;
    cash += income - expense;
    out.push({ key, income, expense, net: income - expense, cash, target: inp.incomeTargets?.[key] ?? null });
  }
  return out;
}

/** ¿Cuántos clientes nuevos faltan para llegar a la meta de ingreso mensual? */
export function newClientsNeeded(opts: {
  targetIncome: number; projectedIncome: number; avgMonthly: number; closeRate: number; pipelineExpectedWins: number;
}) {
  const gap = Math.max(0, opts.targetIncome - opts.projectedIncome);
  const clients = opts.avgMonthly > 0 ? Math.ceil(gap / opts.avgMonthly) : 0;
  const remaining = Math.max(0, clients - opts.pipelineExpectedWins);
  const leadsToGenerate = opts.closeRate > 0 ? Math.ceil(remaining / opts.closeRate) : 0;
  return { gap, clients, remaining, leadsToGenerate };
}

export interface CommitmentLike { direction: "pagar" | "cobrar"; amount: number; due_date: string | null; status: string }

export interface CommitmentsSummary {
  payablePending: number; payable30: number; overdue: number; receivablePending: number; receivable30: number;
  free: number; shortfall: number; byMonth: { key: string; pagar: number; cobrar: number }[];
}

/** Lo comprometido contra lo disponible: libre = disponible − por pagar a 30 días (incluye vencido y sin fecha). */
export function summarizeCommitments(items: CommitmentLike[], today: string, available: number): CommitmentsSummary {
  const in30 = new Date(`${today}T12:00:00`); in30.setDate(in30.getDate() + 30);
  const limit = in30.toISOString().slice(0, 10);
  const s: CommitmentsSummary = { payablePending: 0, payable30: 0, overdue: 0, receivablePending: 0, receivable30: 0, free: 0, shortfall: 0, byMonth: [] };
  const months = new Map<string, { key: string; pagar: number; cobrar: number }>();
  for (const c of items) {
    if (c.status !== "pendiente") continue;
    const amt = Number(c.amount);
    const soon = !c.due_date || c.due_date <= limit;
    if (c.direction === "pagar") {
      s.payablePending += amt; if (soon) s.payable30 += amt;
      if (c.due_date && c.due_date < today) s.overdue += amt;
    } else {
      s.receivablePending += amt; if (soon) s.receivable30 += amt;
    }
    const key = c.due_date ? c.due_date.slice(0, 7) : "sin-fecha";
    const m = months.get(key) ?? { key, pagar: 0, cobrar: 0 };
    m[c.direction] += amt; months.set(key, m);
  }
  s.free = available - s.payable30;
  s.shortfall = Math.max(0, s.payable30 - available);
  s.byMonth = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
  return s;
}
