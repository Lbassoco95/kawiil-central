/**
 * Catálogo Backoffice (D10) — defaults de producto.
 * La fuente de verdad en runtime es `pricing_catalog`; estos valores
 * sirven de fallback si la tabla aún no está migrada.
 */

export interface BackofficePlan {
  plan_code: string;
  plan_name: string;
  list_price: number;
  currency: "MXN";
  vat_included: false;
  max_operations: number;
}

export const BACKOFFICE_PLANS_FALLBACK: readonly BackofficePlan[] = [
  {
    plan_code: "bo_01_arrancando",
    plan_name: "Plan 01 Arrancando",
    list_price: 5000,
    currency: "MXN",
    vat_included: false,
    max_operations: 50,
  },
  {
    plan_code: "bo_02_creciendo",
    plan_name: "Plan 02 Creciendo",
    list_price: 6500,
    currency: "MXN",
    vat_included: false,
    max_operations: 120,
  },
  {
    plan_code: "bo_03_pyme",
    plan_name: "Plan 03 PYME",
    list_price: 9200,
    currency: "MXN",
    vat_included: false,
    max_operations: 220,
  },
] as const;

export const SOFTLANDING_FEE_DEFAULTS = {
  constitucion_mxn: 32000,
  recurrente_usd: 250,
} as const;

export function computeNetPrice(listPrice: number, discountAmount: number, overrideNet?: number | null): number {
  if (overrideNet != null && Number.isFinite(overrideNet)) return Number(overrideNet);
  return Math.max(0, Number(listPrice) - Math.max(0, Number(discountAmount) || 0));
}

export function discountLabel(listPrice: number, discountAmount: number, netPrice: number): string {
  if (discountAmount > 0) {
    return `Descuento $${discountAmount.toLocaleString("es-MX")} (lista $${listPrice.toLocaleString("es-MX")} → neto $${netPrice.toLocaleString("es-MX")})`;
  }
  if (netPrice !== listPrice) {
    return `Ajuste de lista $${listPrice.toLocaleString("es-MX")} → neto $${netPrice.toLocaleString("es-MX")}`;
  }
  return "Sin descuento";
}
