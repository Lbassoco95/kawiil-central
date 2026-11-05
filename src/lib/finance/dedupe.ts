/**
 * Deduplicación por fecha + cargo + abono. Sirve cuando el mismo movimiento llega con otra redacción
 * (Excel contable vs. PDF del banco vs. captura de la app) y el texto no coincide.
 * Respeta movimientos legítimamente repetidos (dos Uber de $119.91 el mismo día): solo se descartan
 * tantos como ya existan.
 */
export interface AmountKeyed { date: string; debit: number; credit: number }

export const amountKey = (m: AmountKeyed) => `${m.date}|${Number(m.debit).toFixed(2)}|${Number(m.credit).toFixed(2)}`;

/** Devuelve los entrantes que NO tienen ya un equivalente (por fecha e importes) entre los existentes. */
export function dropAlreadyLoaded<T extends AmountKeyed>(incoming: T[], existing: AmountKeyed[]): T[] {
  const available = new Map<string, number>();
  for (const e of existing) available.set(amountKey(e), (available.get(amountKey(e)) ?? 0) + 1);
  const kept: T[] = [];
  for (const m of incoming) {
    const k = amountKey(m);
    const n = available.get(k) ?? 0;
    if (n > 0) available.set(k, n - 1);
    else kept.push(m);
  }
  return kept;
}
