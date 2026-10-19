/**
 * reconcile-payments (RF-04) — aplica pagos (savio_payments) a facturas
 * (savio_invoices) creando filas en payment_invoice. Los pagos que no se pueden
 * aplicar solos (sin factura, ambiguos o con sobrepago) van a reconciliation_queue
 * para resolución manual desde Finanzas.
 *
 * Estrategia de auto-match (conservadora, para no aplicar mal):
 *   1) Referencia directa: si el pago trae invoice_savio_id de una factura abierta.
 *   2) Cliente + monto: única factura abierta del cliente cuyo saldo ≈ pago.
 *   Cualquier otra situación → cola.
 * Sobrepago: si el pago excede 1.5× el saldo objetivo, no se aplica solo; va a la
 * cola con reason 'sobrepago' (requiere concepto al aplicar).
 *
 * Idempotente: payment_invoice es único por (org, payment, invoice) y la cola por
 * (org, payment). Auth dual: usuario con acceso a Finanzas, o cron/service-role.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const OVERPAY_FACTOR = 1.5;
// deno-lint-ignore no-explicit-any
type Admin = any;

interface Invoice { id: string; savio_id: string; customer_savio_id: string | null; client_id: string | null; amount: number; currency: string; status: string | null; }
interface Payment { id: string; savio_id: string; customer_savio_id: string | null; invoice_savio_id: string | null; amount: number; currency: string; }

const SETTLED = new Set(["cancelled","canceled","cancelada","void","anulada","paid","pagada","pagado","settled","liquidada","closed","cerrada"]);

function tol(amount: number): number {
  return Math.max(1, Math.abs(amount) * 0.01);
}

async function reconcileOrg(admin: Admin, orgId: string) {
  // Aplicaciones existentes por pago y por factura.
  const { data: appliedRows } = await admin
    .from("payment_invoice")
    .select("payment_id, invoice_id, monto_aplicado")
    .eq("organization_id", orgId);
  const appliedByPayment = new Map<string, number>();
  const appliedByInvoice = new Map<string, number>();
  for (const a of (appliedRows ?? []) as { payment_id: string; invoice_id: string; monto_aplicado: number }[]) {
    appliedByPayment.set(a.payment_id, (appliedByPayment.get(a.payment_id) ?? 0) + Number(a.monto_aplicado));
    appliedByInvoice.set(a.invoice_id, (appliedByInvoice.get(a.invoice_id) ?? 0) + Number(a.monto_aplicado));
  }

  const { data: invRows } = await admin
    .from("savio_invoices")
    .select("id, savio_id, customer_savio_id, client_id, amount, currency, status")
    .eq("organization_id", orgId);
  const invoices = (invRows ?? []) as Invoice[];
  const openInvoices = invoices
    .filter((i) => !SETTLED.has(String(i.status ?? "").toLowerCase()))
    .map((i) => ({ ...i, open: Math.max(Number(i.amount || 0) - (appliedByInvoice.get(i.id) ?? 0), 0) }))
    .filter((i) => i.open > 0.005);
  const openBySavioId = new Map(openInvoices.map((i) => [i.savio_id, i]));
  const openByCustomer = new Map<string, typeof openInvoices>();
  for (const i of openInvoices) {
    if (!i.customer_savio_id) continue;
    const arr = openByCustomer.get(i.customer_savio_id) ?? [];
    arr.push(i);
    openByCustomer.set(i.customer_savio_id, arr);
  }

  const { data: payRows } = await admin
    .from("savio_payments")
    .select("id, savio_id, customer_savio_id, invoice_savio_id, amount, currency")
    .eq("organization_id", orgId);
  const payments = (payRows ?? []) as Payment[];

  const { data: queuedRows } = await admin
    .from("reconciliation_queue")
    .select("payment_id, status")
    .eq("organization_id", orgId);
  const pendingQueue = new Set(
    ((queuedRows ?? []) as { payment_id: string; status: string }[])
      .filter((q) => q.status === "pendiente")
      .map((q) => q.payment_id),
  );

  let applied = 0;
  let queued = 0;

  const enqueue = async (p: Payment, reason: string, candidates: string[]) => {
    if (pendingQueue.has(p.id)) return;
    await admin.from("reconciliation_queue").upsert(
      {
        organization_id: orgId,
        payment_id: p.id,
        payment_savio_id: p.savio_id,
        customer_savio_id: p.customer_savio_id,
        amount: p.amount,
        currency: (p.currency || "MXN").toUpperCase(),
        reason,
        candidates,
        status: "pendiente",
      },
      { onConflict: "organization_id,payment_id" },
    );
    queued++;
  };

  const applyTo = async (p: Payment, inv: { id: string; savio_id: string }, monto: number) => {
    const { error } = await admin.from("payment_invoice").upsert(
      {
        organization_id: orgId,
        payment_id: p.id,
        invoice_id: inv.id,
        payment_savio_id: p.savio_id,
        invoice_savio_id: inv.savio_id,
        monto_aplicado: Number(monto.toFixed(2)),
        auto: true,
      },
      { onConflict: "organization_id,payment_id,invoice_id" },
    );
    if (!error) applied++;
  };

  for (const p of payments) {
    const unapplied = Number(p.amount || 0) - (appliedByPayment.get(p.id) ?? 0);
    if (unapplied <= 0.005) continue;
    if (pendingQueue.has(p.id)) continue;

    // 1) Referencia directa a factura.
    if (p.invoice_savio_id && openBySavioId.has(p.invoice_savio_id)) {
      const inv = openBySavioId.get(p.invoice_savio_id)!;
      if (unapplied > inv.open * OVERPAY_FACTOR) {
        await enqueue(p, "sobrepago", [inv.savio_id]);
      } else {
        await applyTo(p, inv, Math.min(unapplied, inv.open));
      }
      continue;
    }

    // 2) Cliente + monto.
    if (p.customer_savio_id && openByCustomer.has(p.customer_savio_id)) {
      const candidates = openByCustomer.get(p.customer_savio_id)!;
      const matches = candidates.filter((i) => Math.abs(i.open - unapplied) <= tol(unapplied));
      if (matches.length === 1) {
        const inv = matches[0];
        if (unapplied > inv.open * OVERPAY_FACTOR) await enqueue(p, "sobrepago", [inv.savio_id]);
        else await applyTo(p, inv, Math.min(unapplied, inv.open));
      } else {
        // 0 o >1 coincidencias exactas → ambiguo (hay facturas del cliente pero no una clara).
        await enqueue(p, "ambiguo", candidates.map((i) => i.savio_id));
      }
      continue;
    }

    // 3) Sin cliente / sin facturas abiertas.
    await enqueue(p, "sin_factura", []);
  }

  return { orgId, applied, queued, payments: payments.length, openInvoices: openInvoices.length };
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
  let targetOrgs: string[] = [];

  if (isSystem) {
    const { data } = await admin.from("organizations").select("id");
    targetOrgs = ((data ?? []) as { id: string }[]).map((o) => o.id);
  } else {
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Unauthorized" }, 401);
    const { data: fin } = await admin.rpc("has_finance_access", { _user_id: user.id });
    if (!fin) return json({ error: "Forbidden: se requiere acceso a Finanzas." }, 403);
    const { data: orgId } = await admin.rpc("get_user_org_id", { _user_id: user.id });
    if (orgId) targetOrgs = [orgId as string];
  }

  const runs = [];
  for (const orgId of targetOrgs) runs.push(await reconcileOrg(admin, orgId));
  const totalApplied = runs.reduce((s, r) => s + r.applied, 0);
  const totalQueued = runs.reduce((s, r) => s + r.queued, 0);
  return json({ ok: true, applied: totalApplied, queued: totalQueued, runs });
});
