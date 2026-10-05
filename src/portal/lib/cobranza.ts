/** Cobranza derivada de método de pago + complementos (fase 1: solo lectura). */

export type MetodoPago = "PUE" | "PPD" | string | null | undefined;
export type CobranzaEstado = "pagado" | "parcial" | "pendiente" | "no_aplica";

export interface CobranzaInput {
  metodo_pago?: MetodoPago;
  voucher_type?: string | null;
  total?: number | null;
  paid_amount?: number | null;
  payments_count?: number | null;
}

export interface CobranzaInfo {
  estado: CobranzaEstado;
  label: string;
  tone: "ok" | "warn" | "wait" | "info";
  paid: number;
  total: number;
  pendiente: number;
}

const EPS = 0.009;

/** Extrae UUID de CFDI relacionado desde flags de nota de crédito. */
export function relatedUuidFromFlags(flags: { code?: string; reason?: string }[] | null | undefined): string | null {
  for (const f of flags ?? []) {
    if (String(f.code ?? "").toLowerCase() !== "nota_credito") continue;
    const m = String(f.reason ?? "").match(
      /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/,
    );
    if (m) return m[0].toUpperCase();
  }
  return null;
}

export function voucherTypeLabel(voucherType: string | null | undefined): string | null {
  switch (String(voucherType ?? "").toUpperCase()) {
    case "I":
      return "Ingreso";
    case "E":
      return "Nota de crédito";
    case "P":
      return "Complemento de pago";
    case "T":
      return "Traslado";
    case "N":
      return "Nómina";
    default:
      return null;
  }
}

export function metodoPagoLabel(metodo: MetodoPago): string | null {
  if (metodo === "PUE") return "PUE";
  if (metodo === "PPD") return "PPD";
  return null;
}

/** Deriva estado de cobranza para una factura de ingreso (tipo I) o sin tipo. */
export function deriveCobranza(input: CobranzaInput): CobranzaInfo {
  const voucher = String(input.voucher_type ?? "").toUpperCase();
  const total = Math.max(0, Number(input.total ?? 0));
  const paid = Math.max(0, Number(input.paid_amount ?? 0));
  const pendiente = Math.max(0, Math.round((total - paid) * 100) / 100);

  if (voucher === "E" || voucher === "P" || voucher === "T" || voucher === "N") {
    return {
      estado: "no_aplica",
      label: voucher === "E" ? "Nota de crédito" : voucher === "P" ? "Complemento" : "Sin cobranza",
      tone: "info",
      paid,
      total,
      pendiente: 0,
    };
  }

  const method = input.metodo_pago === "PUE" || input.metodo_pago === "PPD" ? input.metodo_pago : null;

  if (method === "PUE") {
    return { estado: "pagado", label: "Pagado", tone: "ok", paid: total, total, pendiente: 0 };
  }

  if (method === "PPD") {
    if (paid <= EPS) {
      return { estado: "pendiente", label: "Pendiente", tone: "wait", paid: 0, total, pendiente: total };
    }
    if (paid + EPS < total) {
      return { estado: "parcial", label: "Parcial", tone: "warn", paid, total, pendiente };
    }
    return { estado: "pagado", label: "Pagado", tone: "ok", paid, total, pendiente: 0 };
  }

  // Sin método publicado (metadatos SatGo): no inventar cobranza.
  return {
    estado: "no_aplica",
    label: "Sin dato de cobro",
    tone: "info",
    paid,
    total,
    pendiente: 0,
  };
}
