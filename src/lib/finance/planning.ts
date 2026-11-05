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
  id: string; opening_balance: number; counts_as_available: boolean;
}

/** Saldo calculado = saldo inicial + abonos − cargos. */
export function accountBalances(
  accounts: AccountBalanceInput[],
  movements: { account_id: string; debit: number; credit: number }[],
): { byAccount: Record<string, number>; available: number; held: number } {
  const byAccount: Record<string, number> = {};
  accounts.forEach((a) => { byAccount[a.id] = Number(a.opening_balance); });
  for (const m of movements) {
    if (m.account_id in byAccount) byAccount[m.account_id] += Number(m.credit) - Number(m.debit);
  }
  let available = 0; let held = 0;
  for (const a of accounts) {
    if (a.counts_as_available) available += byAccount[a.id];
    else held += byAccount[a.id];
  }
  return { byAccount, available, held };
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
