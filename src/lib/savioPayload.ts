/** Extrae campos habituales del JSON de webhooks Savio (estructura puede variar). */

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function parseNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickAmountFromObject(o: Record<string, unknown>): number | null {
  const keys = ["amount", "total", "monto", "paid_amount", "importe", "subtotal"];
  for (const k of keys) {
    const n = parseNumber(o[k]);
    if (n !== null) return n;
  }
  const cents = parseNumber(o.amount_cents);
  if (cents !== null) return cents / 100;
  return null;
}

/** Monto aproximado si viene en el payload (p. ej. pagos). */
export function extractSavioAmount(payload: unknown): number | null {
  const p = asRecord(payload);
  if (!p) return null;
  const data = asRecord(p.data);
  if (data) {
    const fromData = pickAmountFromObject(data);
    if (fromData !== null) return fromData;
  }
  return pickAmountFromObject(p);
}

/** Texto corto para tabla (folio, cliente, descripción). */
export function extractSavioSummary(payload: unknown): string {
  const p = asRecord(payload);
  if (!p) return "—";
  const data = asRecord(p.data) ?? p;
  const parts: string[] = [];
  const folio = data.folio ?? data.number ?? data.invoice_number ?? data.numero;
  if (typeof folio === "string" || typeof folio === "number") parts.push(String(folio));
  const name =
    data.client_name ??
    data.customer_name ??
    data.cliente ??
    data.razon_social ??
    data.name;
  if (typeof name === "string" && name.trim()) parts.push(name.trim());
  const desc = data.description ?? data.concepto ?? data.memo;
  if (typeof desc === "string" && desc.trim()) parts.push(desc.trim().slice(0, 80));
  const status = data.status ?? data.estado;
  if (typeof status === "string" && status.trim()) parts.push(`Estado: ${status}`);
  return parts.length ? parts.join(" · ") : "—";
}

export const SAVIO_EVENT_LABELS: Record<string, string> = {
  "payment.created": "Pago registrado",
  "payment.deleted": "Pago eliminado",
  "invoice.deleted": "Cargo eliminado",
  "invoice.status.updated": "Estado de cargo actualizado",
};
