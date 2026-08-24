/**
 * Arreglo comercial con partners / convenios.
 *
 * Un partner es un tercero que nos refiere prospectos. El "arreglo" describe
 * qué se le paga y sobre qué: se guarda en el partner y se congela en cada
 * comisión al devengarla, para que renegociar el convenio no altere el
 * histórico ya devengado.
 */

export type CommissionType =
  | "porcentaje"
  | "monto_fijo"
  | "sin_comision"
  | "intercambio"
  | "otro";

export type CommissionBase =
  | "primer_pago"
  | "contrato_total"
  | "mensual_recurrente"
  | "por_lead";

export type PartnerKind = "partner" | "convenio" | "alianza" | "referidor" | "otro";
export type PartnerStatus = "activo" | "pausado" | "terminado";
export type CommissionStatus = "devengada" | "facturada" | "pagada" | "cancelada";

export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  partner: "Partner",
  convenio: "Convenio",
  alianza: "Alianza",
  referidor: "Referidor",
  otro: "Otro",
};

export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  activo: "Activo",
  pausado: "Pausado",
  terminado: "Terminado",
};

export const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  porcentaje: "Porcentaje",
  monto_fijo: "Monto fijo",
  sin_comision: "Sin comisión",
  intercambio: "Intercambio de referidos",
  otro: "Arreglo especial",
};

export const COMMISSION_BASE_LABELS: Record<CommissionBase, string> = {
  primer_pago: "del primer pago",
  contrato_total: "del contrato total",
  mensual_recurrente: "de la mensualidad recurrente",
  por_lead: "por lead entregado",
};

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  devengada: "Devengada",
  facturada: "Facturada",
  pagada: "Pagada",
  cancelada: "Cancelada",
};

export interface Arrangement {
  commission_type: string | null;
  commission_value: number | null;
  commission_base: string | null;
  commission_currency: string | null;
}

function money(value: number, currency: string): string {
  return `${value.toLocaleString("es-MX", {
    style: "currency",
    currency: currency === "USD" ? "USD" : "MXN",
    maximumFractionDigits: 2,
  })} ${currency}`;
}

/** Resumen legible del arreglo, p. ej. "10% del primer pago". */
export function formatArrangement(p: Arrangement): string {
  const type = (p.commission_type || "sin_comision") as CommissionType;
  const currency = p.commission_currency === "USD" ? "USD" : "MXN";
  const base = COMMISSION_BASE_LABELS[(p.commission_base || "primer_pago") as CommissionBase]
    ?? COMMISSION_BASE_LABELS.primer_pago;

  switch (type) {
    case "porcentaje":
      return p.commission_value != null
        ? `${p.commission_value}% ${base}`
        : "Porcentaje por definir";
    case "monto_fijo":
      return p.commission_value != null
        ? `${money(p.commission_value, currency)} ${base}`
        : "Monto fijo por definir";
    case "sin_comision":
      return "Sin comisión";
    case "intercambio":
      return "Intercambio de referidos (sin pago)";
    default:
      return "Arreglo especial (ver notas)";
  }
}

export interface CommissionEstimate {
  /** Monto calculado; null cuando depende de captura manual o falta el valor base. */
  amount: number | null;
  currency: string;
  /** true cuando el monto NO se puede calcular solo y hay que capturarlo. */
  manual: boolean;
}

/**
 * Calcula la comisión de un lead a partir del arreglo del partner.
 *
 * Espeja `accrue_partner_commission()` en la base: el porcentaje aplica sobre
 * el valor estimado del lead (que está en MXN), el monto fijo se paga en la
 * moneda del convenio, y el arreglo especial se captura a mano.
 */
export function estimateCommission(p: Arrangement, baseAmount: number | null): CommissionEstimate {
  const type = (p.commission_type || "sin_comision") as CommissionType;
  const currency = p.commission_currency === "USD" ? "USD" : "MXN";

  switch (type) {
    case "porcentaje": {
      if (baseAmount == null || p.commission_value == null) {
        return { amount: null, currency: "MXN", manual: false };
      }
      return {
        amount: Math.round(baseAmount * (p.commission_value / 100) * 100) / 100,
        currency: "MXN",
        manual: false,
      };
    }
    case "monto_fijo":
      return { amount: p.commission_value ?? null, currency, manual: false };
    case "sin_comision":
    case "intercambio":
      return { amount: 0, currency, manual: false };
    default:
      return { amount: null, currency, manual: true };
  }
}
