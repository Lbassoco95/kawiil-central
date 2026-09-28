/**
 * portal-notify — despacha portal_outbox.
 *   · slack: AVISO al equipo (cliente, asunto y enlace a la bandeja). Nunca el
 *     texto del mensaje: Slack no es almacén de conversaciones con clientes.
 *   · correo: al cliente cuando hay respuesta, documento nuevo, ticket facturado
 *     o con problema. Sale por Microsoft Graph (credenciales de app, como
 *     process-email-queue) desde PORTAL_EMAIL_SENDER.
 * Sin configuración, los pendientes se quedan pendientes (no se pierden).
 * Invocación: cron (x-cron-secret) o service_role. Ver RUNBOOK §4.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, cronAllowed, json } from "../_shared/portal/http.ts";

const CENTRAL_URL = (Deno.env.get("CENTRAL_PUBLIC_URL") ?? Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
const PORTAL_URL = (Deno.env.get("PORTAL_PUBLIC_URL") ?? "").replace(/\/+$/, "");

type Row = { id: number; channel: "slack" | "correo"; event: string; client_id: string | null; payload: Record<string, unknown>; attempts: number };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function slackText(r: Row): string {
  const p = r.payload;
  const link = `${CENTRAL_URL}/comunicacion/clientes${p.thread_id ? `?hilo=${p.thread_id}` : ""}`;
  if (r.event === "mensaje_nuevo") {
    const bandeja = p.kind === "contratacion" ? "Prospectos" : "Clientes";
    return `:incoming_envelope: Mensaje nuevo de *${p.client_name ?? "un cliente"}* en la bandeja «${bandeja}»: «${p.subject ?? ""}». <${link}|Abrir en Kawiil OS>`;
  }
  if (r.event === "cancelacion_solicitada") return `:warning: Solicitud de cancelación del CFDI ${p.cfdi_uuid} (motivo ${p.motivo}). Revísela en Portal de clientes → Facturas.`;
  return `Aviso del portal: ${r.event}`;
}

export function emailFor(r: Row): { subject: string; html: string } {
  const p = r.payload;
  const link = PORTAL_URL || "#";
  const wrap = (title: string, body: string) => ({
    subject: title,
    html: `<div style="font-family:Arial,sans-serif;color:#0B1B3F"><h2 style="color:#0000A1">${esc(title)}</h2><p>${body}</p>` +
      `<p><a href="${link}" style="background:#0075EF;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Abrir el portal</a></p>` +
      `<p style="font-size:12px;color:#555">Este correo es un aviso automático de Kawiil. Por seguridad no incluye el contenido; consúltelo en el portal.</p></div>`,
  });
  switch (r.event) {
    case "respuesta_equipo": return wrap("Tiene una respuesta del equipo de Kawiil", `Respondimos en la conversación «${esc(p.subject)}».`);
    case "documento_nuevo": return wrap("Tiene un documento nuevo", `Publicamos «${esc(p.title)}» en su portal.`);
    case "ticket_facturado": return wrap("Su ticket ya está facturado", "La factura (XML y PDF) ya está disponible en «Tickets».");
    case "ticket_con_problema": return wrap("Un ticket necesita su atención", esc(p.note ?? "Revise el detalle en «Tickets»."));
    case "aviso_equipo": return wrap(String(p.asunto ?? "Aviso de Kawiil"), esc(p.mensaje));
    default: return wrap("Aviso de Kawiil", "Tiene una novedad en su portal.");
  }
}

async function graphToken(): Promise<string | null> {
  const tenant = Deno.env.get("AZURE_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const id = Deno.env.get("AZURE_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const secret = Deno.env.get("AZURE_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!tenant || !id || !secret) return null;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await res.json();
  return res.ok ? j.access_token : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!cronAllowed(req)) return json({ error: "no_autorizado" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  const slackChannel = Deno.env.get("PORTAL_SLACK_CHANNEL_ID");
  const sender = Deno.env.get("PORTAL_EMAIL_SENDER");
  const token = sender ? await graphToken() : null;
  const { data: rows } = await admin.from("portal_outbox").select("id, channel, event, client_id, payload, attempts")
    .eq("status", "pendiente").lt("attempts", 5).order("created_at").limit(50);
  const summary = { enviados: 0, errores: 0, sin_configurar: 0, omitidos: 0 };
  for (const r of (rows ?? []) as Row[]) {
    try {
      if (r.channel === "slack") {
        if (!slackToken || !slackChannel) { summary.sin_configurar++; continue; }
        const res = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel: slackChannel, text: slackText(r), unfurl_links: false }),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(`Slack: ${j.error}`);
      } else {
        const to = Array.isArray(r.payload.to) ? (r.payload.to as string[]) : [];
        if (to.length === 0) {
          await admin.from("portal_outbox").update({ status: "omitido", last_error: "sin destinatarios" }).eq("id", r.id);
          summary.omitidos++; continue;
        }
        if (!sender || !token) { summary.sin_configurar++; continue; }
        const { subject, html } = emailFor(r);
        const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: { subject, body: { contentType: "HTML", content: html }, bccRecipients: to.map((a) => ({ emailAddress: { address: a } })) },
            saveToSentItems: false,
          }),
        });
        if (!res.ok) throw new Error(`Graph ${res.status}`);
      }
      await admin.from("portal_outbox").update({ status: "enviado", sent_at: new Date().toISOString(), attempts: r.attempts + 1 }).eq("id", r.id);
      summary.enviados++;
    } catch (err) {
      await admin.from("portal_outbox").update({
        attempts: r.attempts + 1, last_error: String((err as Error).message).slice(0, 500), status: r.attempts + 1 >= 5 ? "error" : "pendiente",
      }).eq("id", r.id);
      summary.errores++;
    }
  }
  return json(summary);
});
