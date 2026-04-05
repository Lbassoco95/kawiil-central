import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function appendOpenPixel(html: string, pixelUrl: string): string {
  const tag =
    `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" referrerpolicy="no-referrer-when-downgrade" />`;
  if (html.toLowerCase().includes("</body>")) {
    return html.replace(/<\/body>/i, `${tag}</body>`);
  }
  return html + tag;
}

function wrapLinksForTracking(html: string, eid: string, base: string): string {
  return html.replace(
    /<a\s+([^>]*\bhref=)(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
    (_m, pre: string, q: string, url: string, rest: string) => {
      const enc = encodeURIComponent(url);
      return `<a ${pre}${q}${base}?eid=${eid}&t=click&u=${enc}${q}${rest}>`;
    },
  );
}

async function fetchLatestSentMessage(
  token: string,
  sender: string,
  toEmail: string,
): Promise<{ id: string; conversationId?: string } | null> {
  const esc = toEmail.replace(/'/g, "''");
  const filter = `toRecipients/any(r:r/emailAddress/address eq '${esc}')`;
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/mailFolders/sentItems/messages?$filter=${
      encodeURIComponent(filter)
    }&$top=3&$orderby=sentDateTime desc&$select=id,conversationId,sentDateTime`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const j = await r.json();
  const v = j.value;
  if (!Array.isArray(v) || v.length === 0) return null;
  return { id: v[0].id as string, conversationId: v[0].conversationId as string | undefined };
}

function interpolate(html: string, vars: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

async function getAppOnlyGraphToken(): Promise<string> {
  const tenant = Deno.env.get("AZURE_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const secret = Deno.env.get("AZURE_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) {
    throw new Error("Faltan credenciales Azure/MICROSOFT para Graph");
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  const j = await res.json();
  if (!res.ok) throw new Error(`Token: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const headerSecret = req.headers.get("x-cron-secret");
    const auth = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const okCron = cronSecret && headerSecret === cronSecret;
    const okService = auth === `Bearer ${serviceKey}`;
    if (!okCron && !okService) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const now = new Date().toISOString();
    const { data: batch, error: qe } = await svc.from("email_log")
      .select("*")
      .eq("status", "queued")
      .lte("scheduled_at", now)
      .limit(40);

    if (qe) throw qe;

    const rows = batch || [];
    let sent = 0;
    let skipped = 0;

    const token = await getAppOnlyGraphToken().catch((e) => {
      console.error("Graph token:", e);
      return null;
    });

    if (!token) {
      return new Response(JSON.stringify({ error: "No se pudo obtener token Graph", processed: 0 }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sender = Deno.env.get("SENDER_EMAIL") || "comercial@kawiil.mx";
    const trackingOn = Deno.env.get("EMAIL_TRACKING") !== "false";
    const trackingBase = `${supabaseUrl}/functions/v1/email-tracking`;

    for (const row of rows) {
      const { data: lead, error: leErr } = await svc.from("leads").select("*").eq("id", row.lead_id).single();
      if (leErr || !lead) {
        await svc.from("email_log").update({ status: "cancelled", error_message: "Lead no encontrado" }).eq(
          "id",
          row.id,
        );
        skipped++;
        continue;
      }

      if (!lead.email || !lead.is_active) {
        await svc.from("email_log").update({ status: "cancelled", error_message: "Lead inactivo o sin email" }).eq(
          "id",
          row.id,
        );
        skipped++;
        continue;
      }

      const { data: stage } = await svc.from("pipeline_stages")
        .select("is_terminal, slug")
        .eq("id", lead.stage_id)
        .maybeSingle();

      if (stage?.is_terminal) {
        await svc.from("email_log").update({ status: "cancelled" }).eq("id", row.id);
        skipped++;
        continue;
      }

      let subject = row.subject as string;
      let html = "";

      if (row.template_id) {
        const { data: tpl } = await svc.from("email_templates").select("*").eq("id", row.template_id).single();
        if (tpl) {
          subject = subject || tpl.subject;
          html = tpl.body_html;
        }
      }

      const vars: Record<string, string> = {
        nombre: lead.full_name || "",
        empresa: lead.company_name || "",
        pais: lead.country_name || "",
        campana: lead.campaign_name || "",
      };
      subject = interpolate(subject || "", vars);
      html = interpolate(html || "", vars);

      if (!html.trim()) {
        await svc.from("email_log").update({ status: "failed", error_message: "Sin cuerpo HTML" }).eq("id", row.id);
        skipped++;
        continue;
      }

      const bodyText = stripHtml(html);
      let htmlToSend = html;
      if (trackingOn) {
        htmlToSend = wrapLinksForTracking(htmlToSend, row.id as string, trackingBase);
        htmlToSend = appendOpenPixel(htmlToSend, `${trackingBase}?eid=${row.id}&t=open`);
      }

      const graphRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: "HTML", content: htmlToSend },
              toRecipients: [{ emailAddress: { address: lead.email } }],
            },
            saveToSentItems: true,
          }),
        },
      );

      if (!graphRes.ok) {
        const errText = await graphRes.text();
        await svc.from("email_log").update({
          status: "failed",
          error_message: errText.slice(0, 500),
        }).eq("id", row.id);
        skipped++;
        continue;
      }

      await new Promise((r) => setTimeout(r, 600));
      const sentMeta = await fetchLatestSentMessage(token, sender, lead.email as string);
      const graphId = sentMeta?.id ?? null;
      const conversationId = sentMeta?.conversationId ?? null;

      await svc.from("email_log").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        subject,
        body_html: html,
        body_text: bodyText,
        from_email: sender,
        from_name: "Kawiil",
        direction: "outbound",
        graph_message_id: graphId,
        conversation_id: conversationId,
      }).eq("id", row.id);

      await svc.from("lead_activities").insert({
        lead_id: lead.id,
        user_id: null,
        type: "email_sent",
        metadata: { email_log_id: row.id, source: "queue" },
      });

      sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped, examined: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-email-queue:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
