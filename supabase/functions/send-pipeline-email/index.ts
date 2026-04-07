/**
 * Envío manual desde la app (JWT usuario). Requiere: migración pipeline email (email_log columnas),
 * secrets AZURE_* o MICROSOFT_*, SENDER_EMAIL; Azure Mail.Send. Opcional: EMAIL_TRACKING=false para
 * desactivar pixel/enlaces. Deploy: `supabase functions deploy send-pipeline-email` (verify_jwt true).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function interpolate(html: string, vars: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

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

async function getAppOnlyGraphToken(): Promise<string> {
  const tenant = Deno.env.get("AZURE_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const secret = Deno.env.get("AZURE_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) {
    throw new Error("Faltan AZURE_* o MICROSOFT_* para client credentials");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as {
      lead_id: string;
      template_id?: string;
      email_log_id?: string;
      subject?: string;
      body_html?: string;
      in_reply_to?: string;
      attachments?: Array<{
        name: string;
        contentType: string;
        contentBytes: string;
      }>;
    };

    if (!body.lead_id) {
      return new Response(JSON.stringify({ error: "lead_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceKey);

    const { data: lead, error: le } = await userClient.from("leads").select("*").eq("id", body.lead_id).single();
    if (le || !lead) {
      return new Response(JSON.stringify({ error: "Lead no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const to = lead.email as string | null;
    if (!to) {
      return new Response(JSON.stringify({ error: "Lead sin email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subject = body.subject || "";
    let html = body.body_html || "";

    if (body.template_id) {
      const { data: tpl } = await svc.from("email_templates")
        .select("*")
        .eq("id", body.template_id)
        .eq("organization_id", lead.organization_id)
        .single();
      if (tpl) {
        subject = subject || (tpl.subject as string);
        html = html || (tpl.body_html as string);
      }
    }

    const vars: Record<string, string> = {
      nombre: lead.full_name || "",
      email: to || "",
      empresa: lead.company_name || "",
      pais: lead.country_name || "",
      campana: lead.campaign_name || "",
    };
    subject = interpolate(subject, vars);
    html = interpolate(html, vars);

    if (!subject.trim() || !html.trim()) {
      return new Response(JSON.stringify({ error: "Asunto y cuerpo requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sender = Deno.env.get("SENDER_EMAIL") || "comercial@kawiil.mx";
    const token = await getAppOnlyGraphToken();

    const effectiveLogId = body.email_log_id ?? crypto.randomUUID();
    const bodyText = stripHtml(html);
    const preNow = new Date().toISOString();

    if (!body.email_log_id) {
      await svc.from("email_log").insert({
        id: effectiveLogId,
        lead_id: lead.id,
        template_id: body.template_id || null,
        to_email: to,
        subject,
        status: "sent",
        sent_at: preNow,
        body_html: html,
        body_text: bodyText,
        from_email: sender,
        from_name: "Kawiil",
        direction: "outbound",
        in_reply_to: body.in_reply_to || null,
      });
    }

    const trackingOn = Deno.env.get("EMAIL_TRACKING") !== "false";
    const trackingBase = `${supabaseUrl}/functions/v1/email-tracking`;
    let htmlToSend = html;
    if (trackingOn) {
      htmlToSend = wrapLinksForTracking(htmlToSend, effectiveLogId, trackingBase);
      htmlToSend = appendOpenPixel(htmlToSend, `${trackingBase}?eid=${effectiveLogId}&t=open`);
    }

    const messagePayload: Record<string, unknown> = {
      subject,
      body: { contentType: "HTML", content: htmlToSend },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    if (body.attachments?.length) {
      messagePayload.attachments = body.attachments.map((attachment) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.name,
        contentType: attachment.contentType || "application/octet-stream",
        contentBytes: attachment.contentBytes,
      }));
    }

    if (body.in_reply_to) {
      const om = await fetch(
        `https://graph.microsoft.com/v1.0/users/${
          encodeURIComponent(sender)
        }/messages/${body.in_reply_to}?$select=conversationId`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (om.ok) {
        const oj = await om.json();
        if (oj.conversationId) messagePayload.conversationId = oj.conversationId;
      }
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
          message: messagePayload,
          saveToSentItems: true,
        }),
      },
    );

    if (!graphRes.ok) {
      const errText = await graphRes.text();
      await svc.from("email_log").update({
        status: "failed",
        error_message: errText.slice(0, 500),
        sent_at: null,
      }).eq("id", effectiveLogId);
      throw new Error(`Graph sendMail: ${errText.slice(0, 400)}`);
    }

    await new Promise((r) => setTimeout(r, 800));
    const sentMeta = await fetchLatestSentMessage(token, sender, to);
    const graphId = sentMeta?.id ?? null;
    const conversationId = sentMeta?.conversationId ?? null;

    const now = new Date().toISOString();

    await svc.from("email_log").update({
      status: "sent",
      sent_at: now,
      subject,
      body_html: html,
      body_text: bodyText,
      from_email: sender,
      from_name: "Kawiil",
      direction: "outbound",
      graph_message_id: graphId,
      conversation_id: conversationId,
      in_reply_to: body.in_reply_to || null,
      error_message: null,
    }).eq("id", effectiveLogId);

    await svc.from("lead_activities").insert({
      lead_id: lead.id,
      user_id: user.id,
      type: "email_sent",
      metadata: {
        template_id: body.template_id,
        email_log_id: effectiveLogId,
        subject,
      },
    });

    return new Response(JSON.stringify({ ok: true, email_log_id: effectiveLogId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-pipeline-email:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
