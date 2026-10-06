export interface FiscalInvoice {
  id: string;
  direction: "emitida" | "recibida";
  issuedAt: string;
  paymentMethod: "PUE" | "PPD" | null;
  subtotal: number;
  total: number;
  vatTransferred: number;
  vatWithheld: number;
  incomeTaxWithheld: number;
  vatByRate: Partial<Record<"16" | "8" | "0" | "exempt", number>>;
  payments?: { paidAt: string; amount: number }[];
  detailComplete: boolean;
}

export interface FiscalEstimate {
  vatTransferred: number;
  vatCreditable: number;
  vatWithheldFromCompany: number;
  vatWithheldByCompany: number;
  incomeTaxWithheldFromCompany: number;
  incomeTaxWithheldByCompany: number;
  estimatedVat: number;
  pendingPayment: string[];
  completeInvoices: number;
  metadataOnlyInvoices: number;
  invoiceIds: Record<string, string[]>;
  byRate: Record<"16" | "8" | "0" | "exempt", { transferred: number; creditable: number }>;
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const inPeriod = (date: string, start: string, end: string) => date >= start && date <= end;

function paidRatio(invoice: FiscalInvoice, start: string, end: string, basis: "cash_flow" | "issuance") {
  if (basis === "issuance" || invoice.paymentMethod === "PUE") return inPeriod(invoice.issuedAt.slice(0, 10), start, end) ? 1 : 0;
  if (invoice.paymentMethod !== "PPD" || !invoice.payments?.length || invoice.total <= 0) return 0;
  const paid = invoice.payments.filter((payment) => inPeriod(payment.paidAt.slice(0, 10), start, end)).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.min(1, Math.max(0, paid / invoice.total));
}

export function calculateFiscalEstimate(invoices: FiscalInvoice[], start: string, end: string, basis: "cash_flow" | "issuance" = "cash_flow"): FiscalEstimate {
  const result: FiscalEstimate = {
    vatTransferred: 0,
    vatCreditable: 0,
    vatWithheldFromCompany: 0,
    vatWithheldByCompany: 0,
    incomeTaxWithheldFromCompany: 0,
    incomeTaxWithheldByCompany: 0,
    estimatedVat: 0,
    pendingPayment: [],
    completeInvoices: invoices.filter((invoice) => invoice.detailComplete).length,
    metadataOnlyInvoices: invoices.filter((invoice) => !invoice.detailComplete).length,
    invoiceIds: { vatTransferred: [], vatCreditable: [], vatWithheldFromCompany: [], vatWithheldByCompany: [] },
    byRate: { "16": { transferred: 0, creditable: 0 }, "8": { transferred: 0, creditable: 0 }, "0": { transferred: 0, creditable: 0 }, exempt: { transferred: 0, creditable: 0 } },
  };
  for (const invoice of invoices.filter((item) => item.detailComplete)) {
    const ratio = paidRatio(invoice, start, end, basis);
    if (!ratio) {
      if (basis === "cash_flow" && invoice.paymentMethod === "PPD" && inPeriod(invoice.issuedAt.slice(0, 10), start, end)) result.pendingPayment.push(invoice.id);
      continue;
    }
    const issued = invoice.direction === "emitida";
    const vat = round(invoice.vatTransferred * ratio);
    const vatWithheld = round(invoice.vatWithheld * ratio);
    const incomeTax = round(invoice.incomeTaxWithheld * ratio);
    if (issued) {
      result.vatTransferred += vat;
      result.vatWithheldFromCompany += vatWithheld;
      result.incomeTaxWithheldFromCompany += incomeTax;
      result.invoiceIds.vatTransferred.push(invoice.id);
      if (vatWithheld) result.invoiceIds.vatWithheldFromCompany.push(invoice.id);
    } else {
      result.vatCreditable += vat;
      result.vatWithheldByCompany += vatWithheld;
      result.incomeTaxWithheldByCompany += incomeTax;
      result.invoiceIds.vatCreditable.push(invoice.id);
      if (vatWithheld) result.invoiceIds.vatWithheldByCompany.push(invoice.id);
    }
    for (const rate of ["16", "8", "0", "exempt"] as const) {
      result.byRate[rate][issued ? "transferred" : "creditable"] += round((invoice.vatByRate[rate] ?? 0) * ratio);
    }
  }
  result.vatTransferred = round(result.vatTransferred);
  result.vatCreditable = round(result.vatCreditable);
  result.vatWithheldFromCompany = round(result.vatWithheldFromCompany);
  result.vatWithheldByCompany = round(result.vatWithheldByCompany);
  result.incomeTaxWithheldFromCompany = round(result.incomeTaxWithheldFromCompany);
  result.incomeTaxWithheldByCompany = round(result.incomeTaxWithheldByCompany);
  result.estimatedVat = round(result.vatTransferred - result.vatCreditable - result.vatWithheldFromCompany + result.vatWithheldByCompany);
  return result;
}

export function ivaBasisLabel(basis: "cash_flow" | "issuance"): string {
  return basis === "cash_flow"
    ? "Flujo de efectivo (PUE en emisión; PPD al cobro/pago)"
    : "Fecha de emisión (PUE y PPD al emitir)";
}

/**
 * Base gravable / subtotal de un cobro PPD.
 * El complemento publica `paid_amount` sobre el total con IVA; el KPI bruto
 * aplica la proporción subtotal/total para no mezclar IVA en el ingreso.
 */
function brutoFromPaidAmount(invoice: FiscalInvoice, paidAmount: number): number {
  const total = Math.max(0, Number(invoice.total ?? 0));
  const subtotal = Math.max(0, Number(invoice.subtotal ?? 0));
  if (paidAmount <= 0) return 0;
  if (total > 0 && subtotal >= 0) return paidAmount * (subtotal / total);
  // Sin total publicado no se puede separar IVA → no inventa bruto.
  return 0;
}

/**
 * Ingreso bruto del periodo (base gravable / subtotal, sin IVA):
 * - PUE → `subtotal` si la emisión cae en el periodo.
 * - PPD → porción bruta de complementos con `paidAt` en el periodo
 *   (`paid_amount × subtotal/total`).
 * No suma PPD sin complemento ni CFDI sin método publicado.
 * El IVA va al cuadro aparte (trasladado / acreditable / estimado).
 */
export function calculatePeriodIncome(
  invoices: FiscalInvoice[],
  start: string,
  end: string,
): {
  ingreso_total: number;
  ingreso_bruto: number;
  pue_count: number;
  ppd_complement_count: number;
  pending_cobranza: number;
  basis: "subtotal";
} {
  let ingreso = 0;
  let pueCount = 0;
  let ppdComplementCount = 0;
  let pendingCobranza = 0;
  for (const invoice of invoices) {
    if (invoice.direction !== "emitida") continue;
    if (invoice.paymentMethod === "PUE") {
      if (inPeriod(invoice.issuedAt.slice(0, 10), start, end)) {
        ingreso += Math.max(0, Number(invoice.subtotal ?? 0));
        pueCount += 1;
      }
      continue;
    }
    if (invoice.paymentMethod === "PPD") {
      let periodBruto = 0;
      for (const payment of invoice.payments ?? []) {
        if (inPeriod(payment.paidAt.slice(0, 10), start, end)) {
          periodBruto += brutoFromPaidAmount(invoice, payment.amount);
        }
      }
      if (periodBruto > 0) {
        ingreso += periodBruto;
        ppdComplementCount += 1;
      }
      const lifetime = (invoice.payments ?? []).reduce((s, p) => s + p.amount, 0);
      if (lifetime <= 0 && inPeriod(invoice.issuedAt.slice(0, 10), start, end) && invoice.total > 0) {
        pendingCobranza += 1;
      }
    }
  }
  const bruto = round(ingreso);
  return {
    ingreso_total: bruto,
    ingreso_bruto: bruto,
    pue_count: pueCount,
    ppd_complement_count: ppdComplementCount,
    pending_cobranza: pendingCobranza,
    basis: "subtotal",
  };
}

/**
 * Gasto subtotal del periodo (CFDI recibidas, base gravable / sin IVA).
 * Solo tipo ingreso (I); NC/complementos no suman al KPI de egreso.
 */
export function calculatePeriodExpense(
  invoices: FiscalInvoice[],
  start: string,
  end: string,
): { gasto_total: number; gasto_subtotal: number; count: number; basis: "subtotal" } {
  let gasto = 0;
  let count = 0;
  for (const invoice of invoices) {
    if (invoice.direction !== "recibida") continue;
    if (!inPeriod(invoice.issuedAt.slice(0, 10), start, end)) continue;
    const sub = Math.max(0, Number(invoice.subtotal ?? 0));
    if (sub <= 0 && Number(invoice.total ?? 0) <= 0) continue;
    gasto += sub;
    count += 1;
  }
  const subtotal = round(gasto);
  return { gasto_total: subtotal, gasto_subtotal: subtotal, count, basis: "subtotal" };
}
