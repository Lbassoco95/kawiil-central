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
