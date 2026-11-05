import { norm } from "./bankImport";

const KNOWN: [RegExp, string][] = [
  [/vizum/, "Vizum"], [/fuze\s*labs/, "Fuze Labs"], [/nuup/, "Nuup"], [/scpadi|rivium/, "Scpadi Rivium"], [/efm\s*sportbook/, "EFM Sportbook"],
];

/** Entidad (cliente dueño del dinero) a partir de descripción y observación del movimiento. */
export function detectEntity(description: string, notes?: string | null): string | null {
  const t = norm(`${description} ${notes ?? ""}`);
  for (const [re, name] of KNOWN) if (re.test(t)) return name;
  const m = /spei de [a-z0-9 ]+? de ([a-z0-9 .&]+?) (sapi|sa de|s\.?a\.?)/.exec(t);
  return m ? m[1].replace(/\b\w/g, (c) => c.toUpperCase()).trim() : null;
}

export interface EntityRow { entity: string; deposited: number; paid: number; held: number; lastDeposit: string | null }

/** Tesorería de terceros: depósitos recibidos, pagos al SAT y saldo aún retenido por entidad. */
export function summarizeEntities(
  movements: { description: string; notes?: string | null; entity?: string | null; movement_date: string; debit: number; credit: number }[],
): EntityRow[] {
  const map = new Map<string, EntityRow>();
  for (const m of movements) {
    const entity = m.entity || detectEntity(m.description, m.notes) || "Sin identificar";
    const r = map.get(entity) ?? { entity, deposited: 0, paid: 0, held: 0, lastDeposit: null };
    r.deposited += Number(m.credit); r.paid += Number(m.debit);
    if (Number(m.credit) > 0 && (!r.lastDeposit || m.movement_date > r.lastDeposit)) r.lastDeposit = m.movement_date;
    map.set(entity, r);
  }
  const rows = [...map.values()];
  rows.forEach((r) => { r.held = r.deposited - r.paid; });
  return rows.sort((a, b) => b.held - a.held);
}
