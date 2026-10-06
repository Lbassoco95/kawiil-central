/** Ingreso / egreso del periodo: base gravable (subtotal), sin mezclar IVA. */

export interface PeriodPayment {
  paid_at: string;
  paid_amount: number;
}

export interface PeriodIncomeCfdi {
  direction?: string | null;
  voucher_type?: string | null;
  metodo_pago?: string | null;
  payment_method?: string | null;
  fecha?: string | null;
  issued_at?: string | null;
  /** Base gravable (preferido para KPI bruto). */
  subtotal?: number | null;
  total?: number | null;
  sat_status?: string | null;
  paid_amount?: number | null;
  payments?: PeriodPayment[] | null;
}

export interface PeriodIncomeResult {
  /**
   * Ingreso bruto del periodo (subtotal / base gravable).
   * PUE: subtotal en mes de emisión; PPD: porción bruta de complementos.
   */
  total: number;
  pueCount: number;
  ppdComplementCount: number;
  /** PPD emitidos en el periodo aún sin complemento (no entran al KPI). */
  pendingCobranzaCount: number;
  basis: "subtotal";
}

export interface PeriodExpenseResult {
  /** Gasto subtotal del periodo (sin IVA). */
  total: number;
  count: number;
  basis: "subtotal";
}

const EPS = 0.009;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calendarMonthBounds(year: number, month: number): { start: string; end: string; label: string } {
  const mm = String(month).padStart(2, "0");
  const start = `${year}-${mm}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { start, end, label };
}

function issuedDate(row: PeriodIncomeCfdi): string {
  return String(row.fecha ?? row.issued_at ?? "").slice(0, 10);
}

function methodOf(row: PeriodIncomeCfdi): "PUE" | "PPD" | null {
  const m = row.metodo_pago ?? row.payment_method;
  return m === "PUE" || m === "PPD" ? m : null;
}

/** Porción bruta de un pago PPD: paid × subtotal/total. */
export function brutoFromPaidAmount(
  subtotal: number,
  total: number,
  paidAmount: number,
): number {
  if (paidAmount <= EPS) return 0;
  if (total > EPS) return paidAmount * (Math.max(0, subtotal) / total);
  return 0;
}

/**
 * Ingresos brutos del periodo (flujo de cobranza, base gravable):
 * - PUE → subtotal si la fecha de emisión cae en el periodo.
 * - PPD → suma bruta de complementos con `paid_at` en el periodo.
 * - PPD sin complemento → no suma (queda pendiente por cobrar).
 * - Sin método / NC / complemento → no inventa ingreso.
 * IVA no entra en este KPI (cuadro IVA aparte).
 */
export function sumPeriodRecognizedIncome(
  rows: PeriodIncomeCfdi[],
  start: string,
  end: string,
): PeriodIncomeResult {
  let total = 0;
  let pueCount = 0;
  let ppdComplementCount = 0;
  let pendingCobranzaCount = 0;

  for (const row of rows) {
    if (row.sat_status === "cancelado") continue;
    if (row.direction && row.direction !== "emitida") continue;
    const voucher = String(row.voucher_type ?? "I").toUpperCase();
    if (voucher === "E" || voucher === "P" || voucher === "T" || voucher === "N") continue;

    const method = methodOf(row);
    const issued = issuedDate(row);
    const invoiceTotal = Math.max(0, Number(row.total ?? 0));
    const invoiceSubtotal = Math.max(0, Number(row.subtotal ?? 0));

    if (method === "PUE") {
      if (issued && issued >= start && issued <= end) {
        total += invoiceSubtotal;
        pueCount += 1;
      }
      continue;
    }

    if (method === "PPD") {
      const payments = row.payments ?? [];
      let periodBruto = 0;
      for (const p of payments) {
        const d = String(p.paid_at ?? "").slice(0, 10);
        if (d && d >= start && d <= end) {
          periodBruto += brutoFromPaidAmount(invoiceSubtotal, invoiceTotal, Number(p.paid_amount ?? 0));
        }
      }
      if (periodBruto > EPS) {
        total += periodBruto;
        ppdComplementCount += 1;
      }
      const lifetimePaid = Math.max(
        0,
        Number(row.paid_amount ?? 0) || payments.reduce((s, p) => s + Number(p.paid_amount ?? 0), 0),
      );
      if (lifetimePaid <= EPS && issued && issued >= start && issued <= end && invoiceTotal > EPS) {
        pendingCobranzaCount += 1;
      }
    }
  }

  return {
    total: round(total),
    pueCount,
    ppdComplementCount,
    pendingCobranzaCount,
    basis: "subtotal",
  };
}

/**
 * Egresos del periodo = gasto subtotal (base gravable) de CFDI recibidas
 * con fecha de emisión en el periodo. IVA no se mezcla en este KPI.
 */
export function sumPeriodRecognizedExpense(
  rows: PeriodIncomeCfdi[],
  start: string,
  end: string,
): PeriodExpenseResult {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    if (row.sat_status === "cancelado") continue;
    if (row.direction && row.direction !== "recibida") continue;
    const voucher = String(row.voucher_type ?? "I").toUpperCase();
    if (voucher === "E" || voucher === "P" || voucher === "T" || voucher === "N") continue;
    const issued = issuedDate(row);
    if (!issued || issued < start || issued > end) continue;
    const sub = Math.max(0, Number(row.subtotal ?? 0));
    if (sub <= EPS && Math.max(0, Number(row.total ?? 0)) <= EPS) continue;
    total += sub;
    count += 1;
  }
  return { total: round(total), count, basis: "subtotal" };
}
