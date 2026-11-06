/**
 * Conciliación entre lo registrado (Excel contable, capturas, pegado, manual) y el estado de cuenta del banco.
 * Se compara por fecha + importes (cargo/abono); la descripción no cuenta porque cada fuente la redacta distinto.
 */
export interface ExistingMovement {
  id: string;
  date: string;
  debit: number;
  credit: number;
  origin: string;
  bankConfirmed: boolean;
  /** false = lo trajo el banco y nadie lo había registrado. */
  hasRecord: boolean;
  category: string | null;
}

export interface IncomingMovement { date: string; debit: number; credit: number }

export const DEFAULT_TOLERANCE_DAYS = 2;

const key = (m: { debit: number; credit: number }) => `${Number(m.debit).toFixed(2)}|${Number(m.credit).toFixed(2)}`;
const dayDiff = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000));

export interface BankPlan {
  /** El banco trae algo que ya estaba cargado desde el banco (mismo estado de cuenta u otro que se traslapa). */
  alreadyLoaded: number[];
  /** El banco confirma un movimiento que ya estaba registrado. */
  confirm: { index: number; id: string }[];
  /** El banco trae algo que no estaba registrado. */
  insert: number[];
}

/** Estado de cuenta (banco) contra lo que ya existe. Primero fecha exacta, luego con tolerancia. */
export function planBankImport(incoming: IncomingMovement[], existing: ExistingMovement[], tolerance = DEFAULT_TOLERANCE_DAYS): BankPlan {
  const used = new Set<string>();
  const decided = new Map<number, { kind: "skip" | "confirm"; id: string }>();
  const byKey = new Map<string, ExistingMovement[]>();
  for (const e of existing) byKey.set(key(e), [...(byKey.get(key(e)) ?? []), e]);

  for (const pass of tolerance > 0 ? [0, tolerance] : [0]) {
    incoming.forEach((m, i) => {
      if (decided.has(i)) return;
      const cands = (byKey.get(key(m)) ?? [])
        .filter((e) => !used.has(e.id) && dayDiff(e.date, m.date) <= pass)
        // más cercano en fecha; a igualdad, primero lo que el banco aún no había confirmado
        .sort((a, b) => dayDiff(a.date, m.date) - dayDiff(b.date, m.date) || Number(a.bankConfirmed) - Number(b.bankConfirmed));
      const e = cands[0];
      if (!e) return;
      used.add(e.id);
      decided.set(i, { kind: e.bankConfirmed ? "skip" : "confirm", id: e.id });
    });
  }

  const plan: BankPlan = { alreadyLoaded: [], confirm: [], insert: [] };
  incoming.forEach((_, i) => {
    const d = decided.get(i);
    if (!d) plan.insert.push(i);
    else if (d.kind === "skip") plan.alreadyLoaded.push(i);
    else plan.confirm.push({ index: i, id: d.id });
  });
  return plan;
}

export interface RecordPlan {
  insert: number[];
  /** Ya existía. Si era un movimiento que solo trajo el banco, `linkToBank` permite pasarle la clasificación. */
  duplicates: { index: number; existingId: string; linkToBank: boolean }[];
}

/**
 * Registros nuevos (Excel contable, captura, pegado) contra lo existente.
 * Contra otro registro solo cuenta la fecha exacta; contra un movimiento que solo trajo el banco se tolera desfase.
 */
export function planRecordImport(incoming: IncomingMovement[], existing: ExistingMovement[], tolerance = DEFAULT_TOLERANCE_DAYS): RecordPlan {
  const used = new Set<string>();
  const decided = new Map<number, { id: string; link: boolean }>();
  const byKey = new Map<string, ExistingMovement[]>();
  for (const e of existing) byKey.set(key(e), [...(byKey.get(key(e)) ?? []), e]);

  for (const pass of tolerance > 0 ? [0, tolerance] : [0]) {
    incoming.forEach((m, i) => {
      if (decided.has(i)) return;
      const cands = (byKey.get(key(m)) ?? [])
        .filter((e) => {
          if (used.has(e.id)) return false;
          const d = dayDiff(e.date, m.date);
          return e.hasRecord ? d === 0 : d <= pass; // un registro solo se empareja con fecha exacta
        })
        // primero otro registro (es el duplicado de su propio archivo); luego el que solo trajo el banco
        .sort((a, b) => dayDiff(a.date, m.date) - dayDiff(b.date, m.date) || Number(b.hasRecord) - Number(a.hasRecord));
      const e = cands[0];
      if (!e) return;
      used.add(e.id);
      decided.set(i, { id: e.id, link: !e.hasRecord });
    });
  }

  const plan: RecordPlan = { insert: [], duplicates: [] };
  incoming.forEach((_, i) => {
    const d = decided.get(i);
    if (!d) plan.insert.push(i);
    else plan.duplicates.push({ index: i, existingId: d.id, linkToBank: d.link });
  });
  return plan;
}

export interface MonthReconciliation {
  total: number;
  confirmed: number;
  /** Registrado pero el banco no lo confirma (ya hay estado de cuenta cargado de ese mes). */
  unconfirmed: ExistingMovement[];
  /** Lo trajo el banco y nadie lo había registrado. */
  bankOnly: ExistingMovement[];
  /** ¿Hay estado de cuenta cargado de este mes? */
  hasBank: boolean;
}

export function reconcileMonth(items: ExistingMovement[]): MonthReconciliation {
  const hasBank = items.some((m) => m.bankConfirmed);
  return {
    total: items.length,
    confirmed: items.filter((m) => m.bankConfirmed).length,
    unconfirmed: hasBank ? items.filter((m) => !m.bankConfirmed) : [],
    bankOnly: items.filter((m) => m.origin === "banco" && !m.hasRecord),
    hasBank,
  };
}

/** Identidad de un renglón del banco sin su consecutivo (#n): fecha|descripción|referencia|cargo|abono. */
export const bankBase = (hash: string) => hash.replace(/#\d+$/, "");

/**
 * Volver a cargar el mismo estado de cuenta no debe confirmar otros registros: los renglones del banco
 * que ya confirmaron un registro en una carga anterior se omiten (una por una, respetando repetidos).
 */
export function skipAlreadyConfirmed<T extends { dedupeKey: string }>(
  incoming: T[],
  confirmedBases: (string | null)[],
): { remaining: T[]; skipped: T[] } {
  const available = new Map<string, number>();
  for (const b of confirmedBases) if (b) available.set(b, (available.get(b) ?? 0) + 1);
  const remaining: T[] = []; const skipped: T[] = [];
  for (const m of incoming) {
    const base = bankBase(m.dedupeKey);
    const n = available.get(base) ?? 0;
    if (n > 0) { available.set(base, n - 1); skipped.push(m); } else remaining.push(m);
  }
  return { remaining, skipped };
}
