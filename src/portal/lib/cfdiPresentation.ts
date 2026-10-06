/** Presentación cliente de CFDI: cuenta real primero; fixtures didácticos aparte. */

export type SparseCfdiLike = {
  detail_status?: string | null;
  total?: number | null;
  is_test?: boolean | null;
  payment_method?: string | null;
  metodo_pago?: string | null;
  source?: string | null;
  voucher_type?: string | null;
};

const EPS = 0.009;

/** UUID corto para listas (detalle sigue mostrando el completo). */
export function shortUuid(uuid: string | null | undefined): string {
  if (!uuid) return "—";
  const u = String(uuid).trim();
  if (u.length <= 13) return u;
  return `${u.slice(0, 8)}…`;
}

/** Fixtures inventados (`is_test`): no van al KPI/ranking/listado principal de la sesión autenticada. */
export function isDidacticFixtureCfdi(row: SparseCfdiLike): boolean {
  return row.is_test === true;
}

/**
 * CFDI reales de la cuenta con monto/método aún no publicados.
 * Se muestran en el listado principal con badge «Detalle pendiente».
 */
export function isPendingDetailCfdi(row: SparseCfdiLike): boolean {
  if (isDidacticFixtureCfdi(row)) return false;
  const total = Number(row.total ?? 0);
  const method = row.payment_method ?? row.metodo_pago ?? null;
  const meta =
    row.detail_status === "metadata"
    || row.detail_status === "solo_metadatos"
    || (row.detail_status != null && row.detail_status !== "complete");
  if (method === "PUE" || method === "PPD") {
    return meta && total <= EPS;
  }
  if (row.source === "satgo_facfiel" && total <= EPS) return true;
  return meta && total <= EPS && !method;
}

/**
 * @deprecated Usar `isDidacticFixtureCfdi`. Antes ocultaba SatGo $0; ahora aísla fixtures didácticos.
 */
export function isSparseMetadataCfdi(row: SparseCfdiLike): boolean {
  return isDidacticFixtureCfdi(row);
}

/**
 * Particiona filas de sesión autenticada:
 * - `ready` / cuenta = CFDI reales (incl. SatGo solo-metadatos $0)
 * - `pending` / didácticos = fixtures `is_test` (Aldea del Sol, etc.)
 */
export function partitionSparse<T extends SparseCfdiLike>(rows: T[]): { ready: T[]; pending: T[] } {
  const ready: T[] = [];
  const pending: T[] = [];
  for (const row of rows) {
    if (isDidacticFixtureCfdi(row)) pending.push(row);
    else ready.push(row);
  }
  return { ready, pending };
}

export function partitionAccountCfdi<T extends SparseCfdiLike>(rows: T[]): { account: T[]; didactic: T[] } {
  const { ready, pending } = partitionSparse(rows);
  return { account: ready, didactic: pending };
}

/** Flags que ya tienen badge propio o son ruido interno. */
const HIDDEN_FLAG_CODES = new Set([
  "metadata_only",
  "complemento_pago",
  "nota_credito",
]);

export function visibleClientFlags(
  flags: { code?: string; reason?: string }[] | null | undefined,
): { code: string; reason: string }[] {
  return (flags ?? [])
    .map((f) => ({ code: String(f.code ?? ""), reason: String(f.reason ?? "") }))
    .filter((f) => f.code && !HIDDEN_FLAG_CODES.has(f.code.toLowerCase()));
}
