/** Etiquetas legibles para desglose de impuestos en detalle CFDI. */

export type TaxLineLike = {
  tax?: string | null;
  kind?: string | null;
  rate?: number | null;
  base?: number | null;
  amount?: number | null;
  factor?: string | null;
};

const TAX_LABELS: Record<string, string> = {
  "002": "IVA",
  iva: "IVA",
  "001": "ISR",
  isr: "ISR",
  "003": "IEPS",
  ieps: "IEPS",
};

const KIND_LABELS: Record<string, string> = {
  transfer: "Traslado",
  traslado: "Traslado",
  withholding: "Retención",
  retencion: "Retención",
  retención: "Retención",
};

export function taxNameLabel(tax: string | null | undefined): string {
  const key = String(tax ?? "").trim().toLowerCase();
  if (!key) return "—";
  return TAX_LABELS[key] ?? String(tax);
}

export function taxKindLabel(kind: string | null | undefined): string {
  const key = String(kind ?? "").trim().toLowerCase();
  if (!key) return "—";
  return KIND_LABELS[key] ?? String(kind);
}

export function taxRateLabel(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(Number(rate))) return "—";
  const n = Number(rate);
  // SatGo/Facturapi a veces mandan 0.16 y a veces 16.
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return `${round1(pct)} %`;
}

function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/** Agrupa líneas IVA traslado / retención para resumen rápido. */
export function summarizeTaxLines(lines: TaxLineLike[]): {
  ivaTrasladado: number;
  ivaRetenido: number;
  isrRetenido: number;
  other: number;
} {
  let ivaTrasladado = 0;
  let ivaRetenido = 0;
  let isrRetenido = 0;
  let other = 0;
  for (const line of lines) {
    const name = taxNameLabel(line.tax);
    const kind = taxKindLabel(line.kind);
    const amount = Math.max(0, Number(line.amount ?? 0));
    if (name === "IVA" && kind === "Traslado") ivaTrasladado += amount;
    else if (name === "IVA" && kind === "Retención") ivaRetenido += amount;
    else if (name === "ISR" && kind === "Retención") isrRetenido += amount;
    else other += amount;
  }
  const r = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    ivaTrasladado: r(ivaTrasladado),
    ivaRetenido: r(ivaRetenido),
    isrRetenido: r(isrRetenido),
    other: r(other),
  };
}
