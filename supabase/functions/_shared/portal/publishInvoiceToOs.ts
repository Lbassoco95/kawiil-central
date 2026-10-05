/**
 * Publica metadatos de CFDI a Kawiil OS vía portal-system-api (invoice.publish).
 * No envía e.firma, CIEC ni material SatGo — solo metadatos ya procesados.
 *
 * Requiere secretos Edge:
 * - KAWIIL_OS_SYSTEM_API_URL (URL completa de portal-system-api en OS)
 * - CENTRAL_TO_OS_SIGNING_SECRET
 */
import { signSystemRequest } from "./systemAuth.ts";

export type OsInvoicePublishInput = {
  companyRef: string;
  uuid: string;
  direction: "emitida" | "recibida";
  issuedAt?: string | null;
  issuerRfc?: string | null;
  issuerName?: string | null;
  receiverRfc?: string | null;
  receiverName?: string | null;
  total?: number | null;
  subtotal?: number | null;
  satStatus?: string | null;
  paymentMethod?: string | null;
  paymentForm?: string | null;
  currency?: string | null;
  voucherType?: string | null;
};

export type OsPublishResult =
  | { ok: true; skipped?: false; status: number; body: unknown }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; status: number; message: string };

export function osMirrorPublishConfigured(): boolean {
  return !!(
    Deno.env.get("KAWIIL_OS_SYSTEM_API_URL")?.trim() &&
    Deno.env.get("CENTRAL_TO_OS_SIGNING_SECRET")?.trim()
  );
}

export async function publishInvoiceMetadataToOs(
  invoice: OsInvoicePublishInput,
): Promise<OsPublishResult> {
  const endpoint = Deno.env.get("KAWIIL_OS_SYSTEM_API_URL")?.trim() ?? "";
  const secret = Deno.env.get("CENTRAL_TO_OS_SIGNING_SECRET")?.trim() ?? "";
  if (!endpoint || !secret) {
    return { ok: true, skipped: true, reason: "mirror_not_configured" };
  }
  if (!invoice.companyRef.trim()) {
    return { ok: true, skipped: true, reason: "company_ref_missing" };
  }
  const uuid = invoice.uuid.trim().toUpperCase();
  if (!uuid) {
    return { ok: false, status: 400, message: "uuid_required" };
  }

  const payload = {
    idempotency_key: `satgo-cfdi:${invoice.companyRef}:${uuid}:${invoice.direction}`,
    company_ref: invoice.companyRef,
    invoice: {
      uuid,
      external_ref: uuid,
      direction: invoice.direction,
      source: "satgo_facfiel",
      detail_status: "metadata",
      issued_at: invoice.issuedAt ?? null,
      issuer_rfc: invoice.issuerRfc ?? null,
      issuer_name: invoice.issuerName ?? null,
      receiver_rfc: invoice.receiverRfc ?? null,
      receiver_name: invoice.receiverName ?? null,
      voucher_type: invoice.voucherType ?? null,
      payment_form: invoice.paymentForm ?? null,
      payment_method: invoice.paymentMethod ?? null,
      currency: invoice.currency ?? "MXN",
      subtotal: Number(invoice.subtotal ?? 0),
      total: Number(invoice.total ?? 0),
      sat_status: invoice.satStatus ?? "unknown",
    },
  };

  const body = JSON.stringify(payload);
  try {
    const headers = await signSystemRequest("invoice.publish", body, secret);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message:
          typeof parsed === "object" && parsed && "error" in (parsed as object)
            ? String((parsed as { error: unknown }).error)
            : text.slice(0, 200) || `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (e) {
    return {
      ok: false,
      status: 502,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
