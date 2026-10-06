/** Ingreso reconocido del periodo: PUE por emisión; PPD por complemento(s). */

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
  total?: number | null;
  sat_status?: string | null;
  paid_amount?: number | null;
  payments?: PeriodPayment[] | null;
}

export interface PeriodIncomeResult {
  /** Monto reconocido como ingreso del periodo (cobrado). */
  total: number;
  pueCount: number;
  ppdComplementCount: number;
  /** PPD emitidos en el periodo aún sin complemento (no entran al KPI). */
  pendingCobranzaCount: number;
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

/**
 * Ingresos del periodo (flujo de cobranza):
 * - PUE → total si la fecha de emisión cae en el periodo (cobrado).
 * - PPD → suma de complementos con `paid_at` en el periodo (cobrado/parcial).
 * - PPD sin complemento → no suma (queda pendiente por cobrar).
 * - Sin método / NC / complemento → no inventa ingreso.
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

    if (method === "PUE") {
      if (issued && issued >= start && issued <= end) {
        total += invoiceTotal;
        pueCount += 1;
      }
      continue;
    }

    if (method === "PPD") {
      const payments = row.payments ?? [];
      let periodPaid = 0;
      for (const p of payments) {
        const d = String(p.paid_at ?? "").slice(0, 10);
        if (d && d >= start && d <= end) periodPaid += Math.max(0, Number(p.paid_amount ?? 0));
      }
      if (periodPaid > EPS) {
        total += periodPaid;
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
  };
}
