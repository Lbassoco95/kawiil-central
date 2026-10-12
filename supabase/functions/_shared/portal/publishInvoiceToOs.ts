/**
 * Publica CFDI a Kawiil OS vía portal-system-api (invoice.publish).
 * No envía e.firma, CIEC ni material SatGo — solo campos ya procesados.
 *
 * Secretos (Edge env o Vault vía kawiil_vault_secret):
 * - KAWIIL_OS_SYSTEM_API_URL / vault `kawiil_os_system_api_url`
 * - CENTRAL_TO_OS_SIGNING_SECRET / vault `central_to_os_signing_secret`
 */
import type { PublishedInvoice } from "./fiscalMirror.ts";
import { signSystemRequest } from "./systemAuth.ts";

export type OsInvoicePublishInput = {
  companyRef: string;
  invoice: PublishedInvoice;
};

export type OsPublishResult =
  | { ok: true; skipped?: false; status: number; body: unknown; duplicate?: boolean }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; status: number; message: string };

export type MirrorCfg = { endpoint: string; secret: string };

type VaultAdmin = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function loadMirrorCfg(admin?: VaultAdmin): Promise<MirrorCfg | null> {
  let secret = Deno.env.get("CENTRAL_TO_OS_SIGNING_SECRET")?.trim() ?? "";
  let endpoint = Deno.env.get("KAWIIL_OS_SYSTEM_API_URL")?.trim() ?? "";
  if (admin) {
    if (!secret) {
      try {
        const { data } = await admin.rpc("kawiil_vault_secret", {
          secret_name: "central_to_os_signing_secret",
        });
        if (typeof data === "string") secret = data.trim();
      } catch {
        /* ignore */
      }
    }
    if (!endpoint) {
      try {
        const { data } = await admin.rpc("kawiil_vault_secret", {
          secret_name: "kawiil_os_system_api_url",
        });
        if (typeof data === "string") endpoint = data.trim();
      } catch {
        /* ignore */
      }
    }
  }
  if (!secret || !endpoint) return null;
  return { endpoint, secret };
}

export function osMirrorPublishConfigured(): boolean {
  return !!(
    Deno.env.get("KAWIIL_OS_SYSTEM_API_URL")?.trim() &&
    Deno.env.get("CENTRAL_TO_OS_SIGNING_SECRET")?.trim()
  );
}

/** Idempotency incluye calidad/monto para permitir upgrade metadata → complete. */
export function invoicePublishIdempotencyKey(
  companyRef: string,
  invoice: PublishedInvoice,
): string {
  const uuid = String(invoice.uuid ?? "").trim().toUpperCase();
  const detail = invoice.detail_status === "complete" ? "complete" : "metadata";
  const cents = Math.round(Number(invoice.total ?? 0) * 100);
  const method = String(invoice.payment_method ?? "na").toUpperCase();
  const concepts = Array.isArray(invoice.concepts) ? invoice.concepts.length : 0;
  const payments = Array.isArray(invoice.payments) ? invoice.payments.length : 0;
  const paidCents = Math.round(
    (invoice.payments ?? []).reduce((s, p) => s + Number(p.paid_amount ?? 0), 0) * 100,
  );
  // Incluye pagos para poder republicar CFDI P cuando las relacionadas ya existen.
  return `satgo-cfdi:${companyRef}:${uuid}:${invoice.direction}:${detail}:${cents}:${method}:c${concepts}:p${payments}:${paidCents}`;
}

export async function publishInvoiceToOs(
  input: OsInvoicePublishInput,
  cfg?: MirrorCfg | null,
): Promise<OsPublishResult> {
  const resolved = cfg ?? (await loadMirrorCfg());
  if (!resolved) {
    return { ok: true, skipped: true, reason: "mirror_not_configured" };
  }
  if (!input.companyRef.trim()) {
    return { ok: true, skipped: true, reason: "company_ref_missing" };
  }
  const uuid = String(input.invoice.uuid ?? "").trim().toUpperCase();
  if (!uuid) {
    return { ok: false, status: 400, message: "uuid_required" };
  }

  const invoice: PublishedInvoice = {
    ...input.invoice,
    uuid,
    external_ref: input.invoice.external_ref ?? uuid,
    source: input.invoice.source ?? "satgo_facfiel",
  };

  const payload = {
    idempotency_key: invoicePublishIdempotencyKey(input.companyRef, invoice),
    company_ref: input.companyRef,
    invoice,
  };

  const body = JSON.stringify(payload);
  try {
    const headers = await signSystemRequest("invoice.publish", body, resolved.secret);
    const res = await fetch(resolved.endpoint, {
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
    const duplicate =
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { duplicate?: boolean }).duplicate === true;
    return { ok: true, status: res.status, body: parsed, duplicate };
  } catch (e) {
    return {
      ok: false,
      status: 502,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** @deprecated usar publishInvoiceToOs — se mantiene por compat con callers antiguos. */
export async function publishInvoiceMetadataToOs(invoice: {
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
}): Promise<OsPublishResult> {
  return publishInvoiceToOs({
    companyRef: invoice.companyRef,
    invoice: {
      uuid: invoice.uuid,
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
  });
}
