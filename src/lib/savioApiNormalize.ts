/** Normaliza respuestas JSON de la API Savio (estructura variable). */

export function extractSavioList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  const keys = ["data", "items", "results", "records", "invoices", "payments", "customers", "rows"];
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function pickSavioNumber(obj: unknown, keys: string[]): number | null {
  const o = asRecord(obj);
  if (!o) return null;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(/,/g, ""));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

export function pickSavioString(obj: unknown, keys: string[]): string {
  const o = asRecord(obj);
  if (!o) return "—";
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }
  return "—";
}

export function pickSavioDate(obj: unknown, keys: string[]): string | null {
  const s = pickSavioString(obj, keys);
  return s === "—" ? null : s;
}

export type SavioInvoiceRowView = {
  key: string;
  id: string;
  folio: string;
  cliente: string;
  monto: number | null;
  estado: string;
  fecha: string | null;
  raw: unknown;
};

export type SavioPaymentRowView = {
  key: string;
  id: string;
  referencia: string;
  monto: number | null;
  fecha: string | null;
  raw: unknown;
};

export function toInvoiceRowView(row: unknown, index: number): SavioInvoiceRowView {
  const id =
    pickSavioString(row, ["id", "uuid", "invoice_id", "charge_id"]) || `row-${index}`;
  const folio = pickSavioString(row, ["folio", "number", "invoice_number", "numero", "reference"]);
  const cliente = pickSavioString(row, [
    "client_name",
    "customer_name",
    "cliente",
    "razon_social",
    "name",
    "company_name",
  ]);
  const monto = pickSavioNumber(row, [
    "total",
    "total_amount",
    "amount",
    "balance",
    "importe",
    "monto",
    "subtotal",
    "paid_amount",
  ]);
  const estado = pickSavioString(row, ["status", "estado", "state"]);
  const fecha = pickSavioDate(row, [
    "created_at",
    "updated_at",
    "date",
    "fecha",
    "issued_at",
    "due_date",
  ]);
  return {
    key: id,
    id,
    folio: folio === "—" ? id.slice(0, 12) : folio,
    cliente,
    monto,
    estado,
    fecha,
    raw: row,
  };
}

export function toPaymentRowView(row: unknown, index: number): SavioPaymentRowView {
  const id = pickSavioString(row, ["id", "uuid", "payment_id"]) || `pay-${index}`;
  const referencia = pickSavioString(row, [
    "reference",
    "folio",
    "description",
    "concepto",
    "memo",
  ]);
  const monto = pickSavioNumber(row, ["amount", "total", "paid_amount", "monto", "importe"]);
  const fecha = pickSavioDate(row, ["created_at", "date", "fecha", "paid_at"]);
  return {
    key: id,
    id,
    referencia: referencia === "—" ? id.slice(0, 12) : referencia,
    monto,
    fecha,
    raw: row,
  };
}

export function sumInvoiceTotals(rows: SavioInvoiceRowView[]): { sum: number; withAmount: number } {
  let sum = 0;
  let withAmount = 0;
  for (const r of rows) {
    if (r.monto !== null) {
      sum += r.monto;
      withAmount += 1;
    }
  }
  return { sum, withAmount };
}

export function sumPaymentTotals(rows: SavioPaymentRowView[]): { sum: number; withAmount: number } {
  let sum = 0;
  let withAmount = 0;
  for (const r of rows) {
    if (r.monto !== null) {
      sum += r.monto;
      withAmount += 1;
    }
  }
  return { sum, withAmount };
}

export type SavioIncomeBucket = "cobrado" | "pendiente" | "por_cobrar";

/** Agrupa cargos Savio por estado textual (heurística; afinar con docs oficiales). */
export function classifyInvoiceForIncome(estadoRaw: string): SavioIncomeBucket {
  const e = estadoRaw.toLowerCase();
  if (/(paid|pagad|cobrad|liquid|cerrad|closed|settled|complet)/.test(e)) return "cobrado";
  if (/(pend|draft|borrador|open|activ|sent|enviad|venc|overdue|partial|parcial)/.test(e)) {
    return "pendiente";
  }
  if (e === "—" || !e.trim()) return "por_cobrar";
  return "por_cobrar";
}

export function computeSavioIncomeBuckets(rows: SavioInvoiceRowView[]): Record<SavioIncomeBucket, number> {
  const out: Record<SavioIncomeBucket, number> = { cobrado: 0, pendiente: 0, por_cobrar: 0 };
  for (const r of rows) {
    if (r.monto === null) continue;
    const b = classifyInvoiceForIncome(r.estado);
    out[b] += r.monto;
  }
  return out;
}
