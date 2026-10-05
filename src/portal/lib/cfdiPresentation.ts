/** Presentación cliente de CFDI: sin basura técnica ni filas vacías de SatGo. */

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

/**
 * Filas SatGo (u otras) con solo metadatos y $0: no aportan al demo presentable.
 * Las filas DEMO (`is_test`) se conservan aunque sean metadata.
 */
export function isSparseMetadataCfdi(row: SparseCfdiLike): boolean {
  if (row.is_test) return false;
  const total = Number(row.total ?? 0);
  const method = row.payment_method ?? row.metodo_pago ?? null;
  const meta =
    row.detail_status === "metadata"
    || row.detail_status === "solo_metadatos"
    || (row.detail_status != null && row.detail_status !== "complete");
  if (total > EPS) return false;
  if (method === "PUE" || method === "PPD") return false;
  if (row.source === "satgo_facfiel" && total <= EPS) return true;
  return meta && total <= EPS && !method;
}

export function partitionSparse<T extends SparseCfdiLike>(rows: T[]): { ready: T[]; pending: T[] } {
  const ready: T[] = [];
  const pending: T[] = [];
  for (const row of rows) {
    if (isSparseMetadataCfdi(row)) pending.push(row);
    else ready.push(row);
  }
  return { ready, pending };
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
