/**
 * Máquina de estados de un ticket (`fis_receipts.status`).
 *
 * Espejo exacto del CHECK de la migración `20260825034512_juun_fis_schema.sql`.
 * Si aquí se agrega un estado y allá no (o al revés), la base rechaza el
 * INSERT: las dos listas se mueven juntas.
 */

/** Camino feliz, en orden. */
export const JUUN_HAPPY_PATH = [
  "received",
  "extracted",
  "validated",
  "queued",
  "processing",
  "invoiced",
] as const;

/** Salidas laterales: o son terminales, o piden que alguien haga algo. */
export const JUUN_SIDE_EXITS = [
  "needs_data",
  "unknown_merchant",
  "window_expired",
  "not_deductible",
  "duplicate",
  "portal_rejected",
  "manual_queue",
] as const;

export const JUUN_RECEIPT_STATUSES = [...JUUN_HAPPY_PATH, ...JUUN_SIDE_EXITS] as const;

export type JuunReceiptStatus = (typeof JUUN_RECEIPT_STATUSES)[number];

export function isJuunReceiptStatus(value: unknown): value is JuunReceiptStatus {
  return typeof value === "string" && (JUUN_RECEIPT_STATUSES as readonly string[]).includes(value);
}
