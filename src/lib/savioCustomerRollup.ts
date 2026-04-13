import {
  classifyInvoiceForIncome,
  pickSavioNumber,
  type SavioInvoiceRowView,
} from "@/lib/savioApiNormalize";

export type SavioCustomerRollupRow = {
  /** Clave estable para filas (customer_id o nombre normalizado). */
  key: string;
  displayName: string;
  customerId: string | null;
  invoiceCount: number;
  /** Suma de montos en cargos considerados «al día / cobrados». */
  totalAlDia: number;
  /** Suma de montos en cargos pendientes o por cobrar. */
  totalPendiente: number;
  /** Fecha de último movimiento conocida (ISO o texto). */
  lastActivity: string | null;
};

function invoiceIsPaidLike(row: SavioInvoiceRowView): boolean {
  const st = row.estado.toLowerCase();
  if (st === "void") return false;
  const remaining = pickSavioNumber(row.raw, ["amount_remaining", "balance", "amount_due"]);
  if (st === "valid" && remaining !== null && remaining <= 0) return true;
  return classifyInvoiceForIncome(row.estado) === "cobrado";
}

function invoiceIsPendingLike(row: SavioInvoiceRowView): boolean {
  const st = row.estado.toLowerCase();
  if (st === "void") return false;
  if (invoiceIsPaidLike(row)) return false;
  const b = classifyInvoiceForIncome(row.estado);
  return b === "pendiente" || b === "por_cobrar";
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta >= tb ? a : b;
  return a > b ? a : b;
}

/**
 * Agrupa facturas/cargos Savio por cliente para resumen financiero en cliente.
 * Si `customer_id` no viene en el payload, agrupa por nombre de cliente mostrado.
 */
export function rollupSavioInvoicesByCustomer(invoices: SavioInvoiceRowView[]): SavioCustomerRollupRow[] {
  const map = new Map<
    string,
    {
      displayName: string;
      customerId: string | null;
      totalAlDia: number;
      totalPendiente: number;
      count: number;
      last: string | null;
    }
  >();

  for (const inv of invoices) {
    const key =
      inv.customerId && inv.customerId.trim()
        ? `id:${inv.customerId}`
        : `name:${inv.cliente !== "—" ? inv.cliente.trim().toLowerCase() : inv.id}`;
    const displayName = inv.cliente !== "—" ? inv.cliente : inv.customerId ?? "Sin nombre de cliente";
    const cur = map.get(key) ?? {
      displayName,
      customerId: inv.customerId,
      totalAlDia: 0,
      totalPendiente: 0,
      count: 0,
      last: null,
    };
    cur.displayName = displayName;
    if (!cur.customerId && inv.customerId) cur.customerId = inv.customerId;
    cur.count += 1;
    const m = inv.monto ?? 0;
    if (invoiceIsPaidLike(inv)) cur.totalAlDia += m;
    else if (invoiceIsPendingLike(inv)) cur.totalPendiente += m;
    cur.last = maxDate(cur.last, inv.fecha ?? inv.dueDate);
    map.set(key, cur);
  }

  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      displayName: v.displayName,
      customerId: v.customerId,
      invoiceCount: v.count,
      totalAlDia: v.totalAlDia,
      totalPendiente: v.totalPendiente,
      lastActivity: v.last,
    }))
    .sort((a, b) => b.totalPendiente - a.totalPendiente || b.invoiceCount - a.invoiceCount);
}
