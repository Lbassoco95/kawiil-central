/**
 * facturapi-api — emisión Facturapi hospedada en **central** (Fase 1).
 *
 * Polo: las llaves/org pueden vivir aquí; el portal OS aporta la UX y llama
 * portal-api (que usa el mismo EmisorFacturapi) o este endpoint con JWT de staff.
 *
 * Ops: POST body { op: "invoice.create" | "payment.create" | "payment.summary" | "health", ... }
 * Secrets: FACTURAPI_SECRET_KEY, opcional FACTURAPI_ORGANIZATION_ID
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createInvoice,
  facturapiConfigFromEnv,
  FacturapiError,
  paymentSummary,
  borradorToFacturapiIngreso,
  type BorradorFactura,
} from "../_shared/portal/emission/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const cfg = facturapiConfigFromEnv();
  if (!cfg) return json({ error: "facturapi_not_configured", message: "Falta FACTURAPI_SECRET_KEY." }, 503);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

  try {
    const body = await req.json() as Record<string, unknown>;
    const op = String(body.op ?? "");

    if (op === "health") {
      return json({ ok: true, configured: true, organization: cfg.organizationId ?? null });
    }

    if (op === "invoice.create") {
      const borrador = body.borrador as BorradorFactura;
      if (!borrador?.receptor || !Array.isArray(borrador.conceptos)) {
        return json({ error: "invalid_payload", message: "Se requiere borrador con receptor y conceptos." }, 400);
      }
      const invoice = await createInvoice(cfg, borradorToFacturapiIngreso(borrador));
      return json({ ok: true, invoice });
    }

    if (op === "payment.summary") {
      const invoiceId = String(body.invoice_id ?? "");
      const amount = Number(body.amount);
      if (!invoiceId || !(amount > 0)) return json({ error: "invalid_payload" }, 400);
      const summary = await paymentSummary(cfg, invoiceId, amount);
      return json({ ok: true, summary });
    }

    if (op === "payment.create") {
      const paymentForm = String(body.payment_form ?? body.forma_pago ?? "03");
      const related = Array.isArray(body.related_documents) ? body.related_documents : [];
      const customer = body.customer as Record<string, unknown> | undefined;
      if (!customer || related.length === 0) return json({ error: "invalid_payload" }, 400);
      const invoice = await createInvoice(cfg, {
        type: "P",
        customer,
        complements: [{ type: "pago", data: [{ payment_form: paymentForm, related_documents: related }] }],
      });
      return json({ ok: true, invoice });
    }

    return json({ error: "unknown_op", message: `Operación desconocida: ${op}` }, 404);
  } catch (err) {
    if (err instanceof FacturapiError) {
      return json({ error: err.code, message: err.message, details: err.details }, err.status >= 400 ? err.status : 502);
    }
    const message = err instanceof Error ? err.message : "Error inesperado";
    return json({ error: "internal", message }, 500);
  }
});
