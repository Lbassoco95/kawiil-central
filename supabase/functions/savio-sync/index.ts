/**
 * savio-sync — materializa Savio (facturas, pagos, clientes) en tablas locales
 * (savio_invoices / savio_payments / savio_customers) para habilitar due_date,
 * aging, recordatorios y conciliación. Paginado completo por cursor (RF-07: sin
 * tope de 100) y verificación de conteos en savio_sync_runs.
 *
 * Auth dual: JWT de usuario con can_view_savio_finance, o cron (x-cron-secret) /
 * service-role. Idempotente por (organization_id, savio_id) → re-sincronizar
 * hace UPSERT, no duplica.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { savioAuthorizationHeaderValue } from "../_shared/savioAuthHeaders.ts";
import { normalizeSavioApiBase } from "../_shared/savioApiBase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const RESOURCES = ["invoices", "payments", "customers"] as const;
type Resource = (typeof RESOURCES)[number];

const DEFAULT_PATHS: Record<Resource, string> = {
  invoices: "/invoice",
  payments: "/payment",
  customers: "/customer",
};

const PAGE_LIMIT = 100;
const MAX_PAGES = 100; // techo de seguridad (100 * 100 = 10k por recurso)
const UPSERT_CHUNK = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Normalización (portada de src/lib/savioApiNormalize.ts, Deno-only) ─────────
function extractSavioList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  for (const k of ["data", "items", "results", "records", "invoices", "payments", "customers", "rows"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

const CURSOR_KEYS = ["nextCursor", "next_cursor", "nextPageCursor", "next_page_cursor", "cursor"];
const PAGING_CONTAINERS = ["paging", "pagination", "meta", "page_info", "pageInfo"];
function readCursor(o: Record<string, unknown>): string | null {
  for (const k of CURSOR_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
function extractNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const direct = readCursor(root);
  if (direct) return direct;
  for (const c of PAGING_CONTAINERS) {
    const nested = root[c];
    if (nested && typeof nested === "object") {
      const v = readCursor(nested as Record<string, unknown>);
      if (v) return v;
    }
  }
  return null;
}
function extractReportedTotal(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const keys = ["total", "total_count", "totalCount", "count", "total_records", "totalRecords"];
  for (const k of keys) {
    const v = root[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  for (const c of PAGING_CONTAINERS) {
    const nested = root[c] as Record<string, unknown> | undefined;
    if (nested && typeof nested === "object") {
      for (const k of keys) {
        const v = nested[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
    }
  }
  return null;
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }
  return null;
}
function pickNum(o: Record<string, unknown>, keys: string[]): number | null {
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
function pickDate(o: Record<string, unknown>, keys: string[]): string | null {
  const s = pickStr(o, keys);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ── Savio fetch paginado ───────────────────────────────────────────────────────
interface PagedResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
  reportedTotal: number | null;
  error: string | null;
}

async function fetchAllSavio(base: string, apiKey: string, resource: Resource): Promise<PagedResult> {
  const path = DEFAULT_PATHS[resource];
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let reportedTotal: number | null = null;
  let lastNext: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const sp = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) sp.set("cursor", cursor);
    const url = `${base}${path}?${sp.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: savioAuthorizationHeaderValue(apiKey), Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) return { rows, truncated: false, reportedTotal, error: `savio_${res.status}:${text.slice(0, 200)}` };
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    rows.push(...extractSavioList(payload));
    if (reportedTotal === null) reportedTotal = extractReportedTotal(payload);
    lastNext = extractNextCursor(payload);
    if (!lastNext) break;
    cursor = lastNext;
  }
  return { rows, truncated: lastNext !== null, reportedTotal, error: null };
}

// ── Mapeo de fila Savio → fila local ────────────────────────────────────────────
function mapCustomer(o: Record<string, unknown>, orgId: string, clientByCustomer: Map<string, string>) {
  const savioId = pickStr(o, ["id", "uuid", "customer_id"]);
  if (!savioId) return null;
  return {
    organization_id: orgId,
    savio_id: savioId,
    name: pickStr(o, ["name", "legal_name", "company_name", "display_name", "business_name", "razon_social", "customer_name"]),
    email: pickStr(o, ["email", "contact_email", "mail"]),
    phone: pickStr(o, ["phone", "telephone", "mobile", "tel"]),
    rfc: pickStr(o, ["rfc", "tax_id", "taxId", "RFC", "rfc_fiscal"]),
    client_id: clientByCustomer.get(savioId) ?? null,
    raw: o,
    synced_at: new Date().toISOString(),
  };
}
function mapInvoice(o: Record<string, unknown>, orgId: string, clientByCustomer: Map<string, string>) {
  const savioId = pickStr(o, ["id", "uuid", "invoice_id", "charge_id"]);
  if (!savioId) return null;
  const customerSavioId = pickStr(o, ["customer_id", "customer_uuid", "client_id", "customerId", "id_customer"]);
  return {
    organization_id: orgId,
    savio_id: savioId,
    folio: pickStr(o, ["invoice_num", "folio", "number", "invoice_number", "numero", "reference"]),
    customer_savio_id: customerSavioId,
    client_id: customerSavioId ? clientByCustomer.get(customerSavioId) ?? null : null,
    status: pickStr(o, ["status", "estado", "state"]),
    amount: pickNum(o, ["amount_total", "total", "total_amount", "amount", "importe", "monto", "subtotal"]),
    currency: pickStr(o, ["currency", "moneda", "currency_code"]) ?? "MXN",
    invoice_date: pickDate(o, ["invoice_date", "date", "fecha", "issued_at", "created_at"]),
    due_date: pickDate(o, ["due_date", "fecha_vencimiento", "expires_at", "payment_due_date"]),
    raw: o,
    synced_at: new Date().toISOString(),
  };
}
function mapPayment(o: Record<string, unknown>, orgId: string, clientByCustomer: Map<string, string>) {
  const savioId = pickStr(o, ["id", "uuid", "payment_id"]);
  if (!savioId) return null;
  const customerSavioId = pickStr(o, ["customer_id", "customer_uuid", "client_id"]);
  return {
    organization_id: orgId,
    savio_id: savioId,
    reference: pickStr(o, ["reference_num", "reference", "folio", "details", "description", "concepto", "memo"]),
    invoice_savio_id: pickStr(o, ["invoice_id", "charge_id", "invoice_uuid", "document_id"]),
    customer_savio_id: customerSavioId,
    client_id: customerSavioId ? clientByCustomer.get(customerSavioId) ?? null : null,
    amount: pickNum(o, ["amount_paid", "amount", "total", "paid_amount", "monto", "importe"]),
    currency: pickStr(o, ["currency", "moneda", "currency_code"]) ?? "MXN",
    payment_date: pickDate(o, ["payment_date", "date", "fecha", "paid_at", "created_at"]),
    raw: o,
    synced_at: new Date().toISOString(),
  };
}

const TABLE_BY_RESOURCE: Record<Resource, string> = {
  invoices: "savio_invoices",
  payments: "savio_payments",
  customers: "savio_customers",
};

// deno-lint-ignore no-explicit-any
type Admin = any;

async function syncResourceForOrg(
  admin: Admin,
  base: string,
  apiKey: string,
  orgId: string,
  resource: Resource,
  clientByCustomer: Map<string, string>,
): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString();
  const { rows, truncated, reportedTotal, error } = await fetchAllSavio(base, apiKey, resource);

  if (error) {
    const run = {
      organization_id: orgId, resource, status: "error", fetched: rows.length, upserted: 0,
      savio_reported_total: reportedTotal, truncated, discrepancy: true, error,
      started_at: startedAt, finished_at: new Date().toISOString(),
    };
    await admin.from("savio_sync_runs").insert([run]);
    return run;
  }

  const mapper = resource === "invoices" ? mapInvoice : resource === "payments" ? mapPayment : mapCustomer;
  const mapped = rows.map((r) => mapper(r, orgId, clientByCustomer)).filter(Boolean) as Record<string, unknown>[];

  let upserted = 0;
  for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
    const chunk = mapped.slice(i, i + UPSERT_CHUNK);
    const { error: upErr } = await admin
      .from(TABLE_BY_RESOURCE[resource])
      .upsert(chunk, { onConflict: "organization_id,savio_id" });
    if (upErr) {
      const run = {
        organization_id: orgId, resource, status: "partial", fetched: rows.length, upserted,
        savio_reported_total: reportedTotal, truncated, discrepancy: true,
        error: `upsert: ${upErr.message}`, started_at: startedAt, finished_at: new Date().toISOString(),
      };
      await admin.from("savio_sync_runs").insert([run]);
      return run;
    }
    upserted += chunk.length;
  }

  const discrepancy = truncated || (reportedTotal !== null && reportedTotal !== rows.length);
  const run = {
    organization_id: orgId, resource, status: truncated ? "partial" : "ok",
    fetched: rows.length, upserted, savio_reported_total: reportedTotal, truncated, discrepancy,
    error: null, started_at: startedAt, finished_at: new Date().toISOString(),
  };
  await admin.from("savio_sync_runs").insert([run]);
  return run;
}

async function clientMapForOrg(admin: Admin, orgId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await admin
    .from("clients")
    .select("id, savio_customer_id")
    .eq("organization_id", orgId)
    .not("savio_customer_id", "is", null);
  for (const row of (data ?? []) as { id: string; savio_customer_id: string | null }[]) {
    if (row.savio_customer_id) map.set(row.savio_customer_id, row.id);
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET");

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const isSystem = (!!cronSecret && cronHeader === cronSecret) || (!!bearer && bearer === serviceKey);

  const admin = createClient(supabaseUrl, serviceKey);

  // Órganizaciones objetivo.
  let targetOrgs: string[] = [];
  if (isSystem) {
    const { data } = await admin.from("organizations").select("id");
    targetOrgs = ((data ?? []) as { id: string }[]).map((o) => o.id);
  } else {
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Unauthorized" }, 401);
    const { data: savioOk } = await admin.rpc("can_view_savio_finance", { _user_id: user.id });
    if (!savioOk) return json({ error: "Forbidden: se requiere permiso de ingresos Savio." }, 403);
    const { data: orgId } = await admin.rpc("get_user_org_id", { _user_id: user.id });
    if (orgId) targetOrgs = [orgId as string];
  }

  const base = normalizeSavioApiBase(Deno.env.get("SAVIO_API_BASE_URL") || "");
  const apiKey = Deno.env.get("SAVIO_API_KEY");
  if (!base || !apiKey) {
    return json({ ok: false, error: "missing_secrets", missing: [!base && "SAVIO_API_BASE_URL", !apiKey && "SAVIO_API_KEY"].filter(Boolean) }, 200);
  }

  let body: { resource?: string } = {};
  try { body = await req.json(); } catch { /* body opcional */ }
  const requested = body.resource && RESOURCES.includes(body.resource as Resource)
    ? [body.resource as Resource]
    : [...RESOURCES];

  const runs: Record<string, unknown>[] = [];
  for (const orgId of targetOrgs) {
    const clientByCustomer = await clientMapForOrg(admin, orgId);
    // Clientes primero para poder resolver client_id de facturas/pagos si aplica.
    const ordered = ["customers", "invoices", "payments"].filter((r) => requested.includes(r as Resource)) as Resource[];
    for (const resource of ordered) {
      runs.push(await syncResourceForOrg(admin, base, apiKey, orgId, resource, clientByCustomer));
    }
  }

  const ok = runs.every((r) => r.status === "ok");
  return json({ ok, orgs: targetOrgs.length, runs }, 200);
});
