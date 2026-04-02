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
        subject = subject || tpl.subject;
        html = html || tpl.body_html;
      }
    }

    const vars: Record<string, string> = {
      nombre: lead.full_name || "",
      empresa: lead.company_name || "",
      pais: lead.country_name || "",
      campana: lead.campaign_name || "",
    };
    subject = interpolate(subject, vars);
    html = interpolate(html, vars);

    const sender = Deno.env.get("SENDER_EMAIL") || "contacto@kawiil.mx";
    const token = await getAppOnlyGraphToken();

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
            body: { contentType: "HTML", content: html },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          saveToSentItems: true,
        }),
      },
    );

    if (!graphRes.ok) {
      const errText = await graphRes.text();
      if (body.email_log_id) {
        await svc.from("email_log").update({
          status: "failed",
          error_message: errText.slice(0, 500),
        }).eq("id", body.email_log_id);
      }
      throw new Error(`Graph sendMail: ${errText.slice(0, 400)}`);
    }

    let graphId: string | null = null;

    if (body.email_log_id) {
      await svc.from("email_log").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        subject,
        graph_message_id: graphId,
      }).eq("id", body.email_log_id);
    } else {
      await svc.from("email_log").insert({
        lead_id: lead.id,
        template_id: body.template_id || null,
        to_email: to,
        subject,
        status: "sent",
        sent_at: new Date().toISOString(),
        graph_message_id: graphId,
      });
    }

    await svc.from("lead_activities").insert({
      lead_id: lead.id,
      user_id: user.id,
      type: "email_sent",
      metadata: { template_id: body.template_id, email_log_id: body.email_log_id },
    });

    return new Response(JSON.stringify({ ok: true }), {
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
