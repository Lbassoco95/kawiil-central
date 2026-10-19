/**
 * reminder-cron (RF-03) — recordatorios de cobranza automáticos.
 *
 * Recorre las facturas pendientes (v_aging_invoices) y envía recordatorios:
 *   - 3 días antes del vencimiento (stage antes_venc)
 *   - el día del vencimiento (al_vencer)
 *   - cada 5 días de atraso (atraso)
 * vía el servicio notify (correo siempre; WhatsApp si hay credenciales).
 *
 * SEGURIDAD: apagado por defecto. Solo envía si REMINDERS_ENABLED='true'. Sin ese
 * flag corre en dry-run: registra en reminder_log lo que enviaría (estado
 * 'omitido') sin mandar nada. Respeta pausa por cliente y evita duplicados/día.
 *
 * Auth: cron (x-cron-secret) o service-role. No expone ruta de usuario.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendNotification } from "../_shared/notify.ts";
import { loadNotifyConfigFromEnv } from "../_shared/notifyEnv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Stage = "antes_venc" | "al_vencer" | "atraso";

function stageForDaysLate(daysLate: number): Stage | null {
  if (daysLate === -3) return "antes_venc";
  if (daysLate === 0) return "al_vencer";
  if (daysLate > 0 && daysLate % 5 === 0) return "atraso";
  return null;
}

function money(amount: number | null, currency: string): string {
  const n = Number(amount) || 0;
  const cur = currency === "USD" ? "USD" : currency === "EUR" ? "EUR" : "MXN";
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${cur}`;
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// deno-lint-ignore no-explicit-any
type Admin = any;

interface AgingInvoice {
  organization_id: string;
  invoice_id: string;
  savio_id: string;
  client_id: string | null;
  customer_savio_id: string | null;
  folio: string | null;
  currency: string;
  amount: number | null;
  balance: number | null;
  effective_due: string;
  days_late: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET");

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  const isSystem = (!!cronSecret && cronHeader === cronSecret) || (!!bearer && bearer === serviceKey);
  if (!isSystem) return json({ error: "Unauthorized" }, 401);

  const enabled = (Deno.env.get("REMINDERS_ENABLED") || "").toLowerCase() === "true";
  const admin: Admin = createClient(supabaseUrl, serviceKey);
  const config = loadNotifyConfigFromEnv();

  const { data: orgs } = await admin.from("organizations").select("id");
  const orgIds = ((orgs ?? []) as { id: string }[]).map((o) => o.id);

  let considered = 0;
  let sent = 0;
  let skipped = 0;
  let dryRun = 0;

  for (const orgId of orgIds) {
    // Plantillas activas por stage.
    const { data: tplRows } = await admin
      .from("reminder_template")
      .select("stage, subject, body, active")
      .eq("organization_id", orgId);
    const templates = new Map<string, { subject: string; body: string }>();
    for (const t of (tplRows ?? []) as { stage: string; subject: string; body: string; active: boolean }[]) {
      if (t.active) templates.set(t.stage, { subject: t.subject, body: t.body });
    }
    if (templates.size === 0) continue;

    // Clientes Savio: contacto + pausa.
    const { data: custRows } = await admin
      .from("savio_customers")
      .select("savio_id, name, email, reminders_paused")
      .eq("organization_id", orgId);
    const customers = new Map<string, { name: string | null; email: string | null; paused: boolean }>();
    for (const c of (custRows ?? []) as { savio_id: string; name: string | null; email: string | null; reminders_paused: boolean }[]) {
      customers.set(c.savio_id, { name: c.name, email: c.email, paused: !!c.reminders_paused });
    }

    // Facturas pendientes con antigüedad.
    const { data: invRows } = await admin
      .from("v_aging_invoices")
      .select("*")
      .eq("organization_id", orgId);
    const invoices = (invRows ?? []) as AgingInvoice[];

    for (const inv of invoices) {
      const stage = stageForDaysLate(Number(inv.days_late));
      if (!stage) continue;
      const tpl = templates.get(stage);
      if (!tpl) continue;
      considered++;

      const cust = inv.customer_savio_id ? customers.get(inv.customer_savio_id) : undefined;
      const today = new Date().toISOString().slice(0, 10);

      // Dedupe: ¿ya hay registro hoy para esta factura+stage?
      const { data: existing } = await admin
        .from("reminder_log")
        .select("id")
        .eq("organization_id", orgId)
        .eq("savio_invoice_id", inv.savio_id)
        .eq("stage", stage)
        .eq("sent_on", today)
        .limit(1);
      if (existing && existing.length > 0) { skipped++; continue; }

      const vars = {
        cliente: cust?.name || "cliente",
        folio: inv.folio || inv.savio_id.slice(0, 10),
        monto: money(inv.balance ?? inv.amount, inv.currency),
        vencimiento: inv.effective_due,
        dias: String(Math.abs(Number(inv.days_late))),
      };
      const subject = render(tpl.subject, vars);
      const text = render(tpl.body, vars);
      const email = cust?.email || null;

      const baseLog = {
        organization_id: orgId,
        savio_invoice_id: inv.savio_id,
        invoice_id: inv.invoice_id,
        client_id: inv.client_id,
        customer_savio_id: inv.customer_savio_id,
        stage,
        canal: "email",
        destino: email,
        sent_on: today,
      };

      // Motivos de omisión (dry-run o bloqueos).
      let omitReason: string | null = null;
      if (!enabled) omitReason = "recordatorios_desactivados";
      else if (cust?.paused) omitReason = "cliente_en_pausa";
      else if (!email) omitReason = "sin_correo";

      if (omitReason) {
        await admin.from("reminder_log").insert([{ ...baseLog, estado: "omitido", error: omitReason }]);
        if (!enabled) dryRun++; else skipped++;
        continue;
      }

      const result = await sendNotification(
        { admin, config },
        {
          canal: "email",
          destino: email!,
          plantilla: "raw",
          datos: { subject, text },
          organization_id: orgId,
        },
      );

      await admin.from("reminder_log").insert([
        {
          ...baseLog,
          estado: result.estado === "enviado" ? "enviado" : result.estado === "omitido" ? "omitido" : "error",
          error: result.error ?? null,
          enviado_at: result.estado === "enviado" ? new Date().toISOString() : null,
        },
      ]);
      if (result.estado === "enviado") sent++;
      else skipped++;
    }
  }

  return json({ ok: true, enabled, considered, sent, skipped, dryRun, orgs: orgIds.length });
});
