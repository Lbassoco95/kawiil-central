import type { Expense } from "@/hooks/useExpenses";
import type { Client } from "@/hooks/useClients";
import {
  classifyInvoiceForIncome,
  pickSavioNumber,
  pickSavioString,
  type SavioInvoiceRowView,
} from "@/lib/savioApiNormalize";
import { dateInLocalRange, parseSavioDateString, sumSavioOutstandingValid } from "@/lib/financeMonthMetrics";

export type SavioPaymentCustomerRollup = {
  key: string;
  displayName: string;
  customerId: string | null;
  sum: number;
  count: number;
};

export type InvoiceCollectionRow = {
  invoiceId: string;
  folio: string;
  cliente: string;
  customerId: string | null;
  monto: number | null;
  /** Saldo pendiente si Savio lo envía. */
  amountRemaining: number | null;
  dueDate: string | null;
  estado: string;
  daysUntilDue: number | null;
  daysOverdue: number | null;
};

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addLocalDays(d: Date, delta: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta, 0, 0, 0, 0);
  return x;
}

function invoiceIsOpenForCollection(inv: SavioInvoiceRowView): boolean {
  const st = inv.estado.toLowerCase();
  if (st === "void") return false;
  const remaining = pickSavioNumber(inv.raw, ["amount_remaining", "balance", "amount_due"]);
  if (st === "valid" && remaining !== null && remaining <= 0) return false;
  if (classifyInvoiceForIncome(inv.estado) === "cobrado") return false;
  return true;
}

export function rollupSavioPaymentsByCustomerInRange(
  paymentRows: unknown[],
  start: Date,
  end: Date,
): SavioPaymentCustomerRollup[] {
  const map = new Map<
    string,
    { displayName: string; customerId: string | null; sum: number; count: number }
  >();

  for (const row of paymentRows) {
    const payDate = pickSavioString(row, ["payment_date", "paymentDate"]);
    const d = parseSavioDateString(payDate === "—" ? null : payDate);
    if (!d || !dateInLocalRange(d, start, end)) continue;
    const amt = pickSavioNumber(row, ["amount_paid", "amount", "total", "paid_amount"]);
    if (amt === null) continue;
    const customerIdRaw = pickSavioString(row, ["customer_id", "customer_uuid", "client_id", "customerId"]);
    const cid = customerIdRaw === "—" ? null : customerIdRaw;
    const displayName = pickSavioString(row, [
      "customer_display_name",
      "customer_name",
      "client_name",
      "customer_legal_name",
    ]);
    const name = displayName === "—" ? cid ?? "Sin identificar" : displayName;
    const key = cid ? `id:${cid}` : `name:${name.trim().toLowerCase()}`;
    const cur = map.get(key) ?? { displayName: name, customerId: cid, sum: 0, count: 0 };
    cur.sum += amt;
    cur.count += 1;
    if (displayName !== "—") cur.displayName = displayName;
    if (!cur.customerId && cid) cur.customerId = cid;
    map.set(key, cur);
  }

  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      displayName: v.displayName,
      customerId: v.customerId,
      sum: v.sum,
      count: v.count,
    }))
    .sort((a, b) => b.sum - a.sum || b.count - a.count);
}

export function buildInvoiceCollectionQueues(
  invoices: SavioInvoiceRowView[],
  referenceDate = new Date(),
  upcomingDays = 7,
): { overdue: InvoiceCollectionRow[]; upcoming: InvoiceCollectionRow[] } {
  const today0 = startOfLocalDay(referenceDate);
  const upcomingEnd = addLocalDays(today0, upcomingDays);
  upcomingEnd.setHours(23, 59, 59, 999);

  const overdue: InvoiceCollectionRow[] = [];
  const upcoming: InvoiceCollectionRow[] = [];

  for (const inv of invoices) {
    if (!invoiceIsOpenForCollection(inv)) continue;
    const due = inv.dueDate ? parseSavioDateString(inv.dueDate) : null;
    const remaining = pickSavioNumber(inv.raw, ["amount_remaining", "balance", "amount_due"]);
    const base: InvoiceCollectionRow = {
      invoiceId: inv.id,
      folio: inv.folio,
      cliente: inv.cliente !== "—" ? inv.cliente : "Cliente",
      customerId: inv.customerId,
      monto: inv.monto,
      amountRemaining: remaining,
      dueDate: inv.dueDate,
      estado: inv.estado,
      daysUntilDue: null,
      daysOverdue: null,
    };

    if (due && !Number.isNaN(due.getTime())) {
      const due0 = startOfLocalDay(due);
      if (due0 < today0) {
        const daysOverdue = Math.max(
          0,
          Math.floor((today0.getTime() - due0.getTime()) / 86_400_000),
        );
        overdue.push({ ...base, daysOverdue, daysUntilDue: null });
      } else if (due0 >= today0 && due0 <= upcomingEnd) {
        const daysUntilDue = Math.max(
          0,
          Math.floor((due0.getTime() - today0.getTime()) / 86_400_000),
        );
        upcoming.push({ ...base, daysUntilDue, daysOverdue: null });
      }
    }
  }

  overdue.sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0) || (b.amountRemaining ?? 0) - (a.amountRemaining ?? 0));
  upcoming.sort((a, b) => (a.daysUntilDue ?? 99) - (b.daysUntilDue ?? 99));

  return { overdue, upcoming };
}

export type MultiServiceClientRow = {
  clientId: string;
  name: string;
  services: string[];
  savioCustomerId: string | null;
};

export function listMultiServiceClients(clients: Client[]): MultiServiceClientRow[] {
  return clients
    .filter((c) => Array.isArray(c.services) && c.services.length > 1)
    .map((c) => ({
      clientId: c.id,
      name: c.name?.trim() || "Sin nombre",
      services: [...c.services],
      savioCustomerId: c.savio_customer_id?.trim() ? c.savio_customer_id : null,
    }))
    .sort((a, b) => b.services.length - a.services.length || a.name.localeCompare(b.name, "es"));
}

export type FinanceRatioPack = {
  /** (cobrado − gastos pagados) / cobrado; null si cobrado ≤ 0. */
  approxOperatingMargin: number | null;
  /** Cartera vigente / cobrado del periodo; null si cobrado ≤ 0. Indicador de presión, no liquidez. */
  portfolioPressureVsCollected: number | null;
  /** Suma cobros top N / cobrado del periodo; null si cobrado ≤ 0. */
  topClientsShareOfCollected: number | null;
};

export function computeFinanceRatioPack(
  collected: number,
  expensesPaid: number,
  portfolioOutstanding: number,
  topClientsCollectedSum: number,
): FinanceRatioPack {
  const approxOperatingMargin =
    collected > 0 ? (collected - expensesPaid) / collected : null;
  const portfolioPressureVsCollected = collected > 0 ? portfolioOutstanding / collected : null;
  const topClientsShareOfCollected =
    collected > 0 ? topClientsCollectedSum / collected : null;
  return {
    approxOperatingMargin,
    portfolioPressureVsCollected,
    topClientsShareOfCollected,
  };
}

export function portfolioOutstandingFromRows(invoiceRows: unknown[]) {
  return sumSavioOutstandingValid(invoiceRows);
}
