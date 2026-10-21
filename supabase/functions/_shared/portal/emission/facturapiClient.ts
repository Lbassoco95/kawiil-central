/**
 * Cliente HTTP mínimo de Facturapi (https://docs.facturapi.io).
 * Las llaves viven en secretos de Edge (preferible en central; test en ensayo).
 * Nunca se expone al navegador.
 */

const BASE = "https://www.facturapi.io/v2";

export class FacturapiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export type FacturapiConfig = {
  secretKey: string;
  /** Prefijo Organization key cuando se usa multi-org (sk_live_… + org). */
  organizationId?: string | null;
};

function authHeader(cfg: FacturapiConfig): string {
  // Facturapi: Bearer sk_test_… / sk_live_…
  return `Bearer ${cfg.secretKey.trim()}`;
}

export async function facturapiFetch<T = unknown>(
  cfg: FacturapiConfig,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  if (!cfg.secretKey?.trim()) {
    throw new FacturapiError(503, "facturapi_not_configured", "Facturapi no está configurado (falta FACTURAPI_SECRET_KEY).");
  }
  const qs = query
    ? "?" + Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&")
    : "";
  const headers: Record<string, string> = {
    Authorization: authHeader(cfg),
    Accept: "application/json",
  };
  if (cfg.organizationId) headers["Facturapi-Organization"] = cfg.organizationId;
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init = { ...init, body: JSON.stringify(body) };
  }
  const res = await fetch(`${BASE}${path}${qs}`, init);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* raw */ }
  if (!res.ok) {
    const msg = typeof json.message === "string" ? json.message
      : typeof json.error === "string" ? json.error
      : `Facturapi respondió ${res.status}`;
    const code = typeof json.code === "string" ? json.code : "facturapi_error";
    throw new FacturapiError(res.status, code, msg, json);
  }
  return json as T;
}

export type FacturapiInvoice = {
  id: string;
  uuid?: string;
  status?: string;
  livemode?: boolean;
  type?: string;
  total?: number;
  folio_number?: number | string;
  series?: string;
  customer?: { tax_id?: string; legal_name?: string };
  stamp?: { date?: string } | null;
};

export type PaymentSummary = {
  uuid: string;
  folio_number?: number | string;
  series?: string;
  installment: number;
  last_balance: number;
  total?: number;
  currency?: string;
  amount: number;
  taxes?: unknown;
};

/** Crear CFDI tipo I (ingreso) o P (pago) según docs Facturapi. */
export function createInvoice(cfg: FacturapiConfig, body: Record<string, unknown>) {
  return facturapiFetch<FacturapiInvoice>(cfg, "POST", "/invoices", body);
}

export function paymentSummary(cfg: FacturapiConfig, invoiceId: string, amount: number) {
  return facturapiFetch<PaymentSummary>(cfg, "GET", `/invoices/${encodeURIComponent(invoiceId)}/payment-summary`, undefined, { amount });
}

export function retrieveInvoice(cfg: FacturapiConfig, invoiceId: string) {
  return facturapiFetch<FacturapiInvoice>(cfg, "GET", `/invoices/${encodeURIComponent(invoiceId)}`);
}

export function downloadInvoiceXml(cfg: FacturapiConfig, invoiceId: string): Promise<string> {
  return (async () => {
    if (!cfg.secretKey?.trim()) {
      throw new FacturapiError(503, "facturapi_not_configured", "Facturapi no está configurado.");
    }
    const headers: Record<string, string> = { Authorization: authHeader(cfg) };
    if (cfg.organizationId) headers["Facturapi-Organization"] = cfg.organizationId;
    const res = await fetch(`${BASE}/invoices/${encodeURIComponent(invoiceId)}/xml`, { headers });
    if (!res.ok) {
      throw new FacturapiError(res.status, "facturapi_download", `No se pudo descargar XML (${res.status}).`);
    }
    return await res.text();
  })();
}

function defaultEnv(): { get(key: string): string | undefined } {
  try {
    // Deno Edge; en Vitest/Node no existe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (globalThis as any).Deno;
    if (d?.env) return d.env;
  } catch { /* ignore */ }
  return { get: (key: string) => (typeof process !== "undefined" ? process.env?.[key] : undefined) };
}

export function facturapiConfigFromEnv(env: {
  get(key: string): string | undefined;
} = defaultEnv()): FacturapiConfig | null {
  const secretKey = env.get("FACTURAPI_SECRET_KEY") ?? env.get("FACTURAPI_API_KEY") ?? "";
  if (!secretKey.trim()) return null;
  return {
    secretKey,
    organizationId: env.get("FACTURAPI_ORGANIZATION_ID") ?? null,
  };
}
