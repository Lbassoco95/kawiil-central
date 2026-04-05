/**
 * Sincroniza el inbox de Microsoft Graph hacia `email_log` (inbound) y `lead_activities` (email_received).
 *
 * Checklist de despliegue y operación:
 * - Migración: `20260405120000_pipeline_email_threading_tracking.sql` (email_log, email_sync_state, cron).
 * - Secrets Supabase: AZURE_* o MICROSOFT_* (tenant, client id, secret), SENDER_EMAIL, CRON_SECRET alineado con `app.pipeline_cron_secret`.
 * - Azure AD: permisos de aplicación Mail.Read + Mail.Send y consentimiento de administrador.
 * - Deploy: `supabase functions deploy sync-inbox-emails --no-verify-jwt` (ver `supabase/config.toml`).
 * - Cron: job `pipeline-sync-inbox-emails` vía `invoke_sync_inbox_emails_cron()` (header x-cron-secret).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const okCron = cronSecret && headerSecret === cronSecret;
    const okService = auth === `Bearer ${serviceKey}`;

    let restrictOrgId: string | null = null;
    if (!okCron && !okService && auth.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: auth } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: prof } = await userClient.from("profiles").select("organization_id").eq(
        "user_id",
        user.id,
      ).maybeSingle();
      restrictOrgId = prof?.organization_id ?? null;
      if (!restrictOrgId) {
        return new Response(JSON.stringify({ error: "Sin organización" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (!okCron && !okService) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceKey);
    const sender = Deno.env.get("SENDER_EMAIL") || "contacto@kawiil.mx";
    const token = await getAppOnlyGraphToken();

    const { data: syncRows } = await svc.from("email_sync_state").select("*").eq("mailbox_email", sender);
    let since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (syncRows && syncRows.length > 0) {
      const dates = syncRows.map((r) => r.last_sync_at).filter(Boolean) as string[];
      if (dates.length > 0) {
        const oldest = dates.reduce((a, b) => (a < b ? a : b));
        since = oldest;
      }
    }

    const sinceEnc = encodeURIComponent(since);
    const messagesUrl =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/mailFolders/inbox/messages?$filter=receivedDateTime ge ${sinceEnc}&$select=id,subject,body,bodyPreview,from,toRecipients,receivedDateTime,conversationId,internetMessageId,hasAttachments,isRead&$orderby=receivedDateTime desc&$top=80`;

    const messagesRes = await fetch(messagesUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!messagesRes.ok) {
      const err = await messagesRes.text();
      throw new Error(`Graph inbox: ${err.slice(0, 500)}`);
    }

    const messagesData = await messagesRes.json();
    const messages = messagesData.value || [];

    let qb = svc.from("leads").select("id, email, organization_id").eq("is_active", true).not(
      "email",
      "is",
      null,
    );
    if (restrictOrgId) qb = qb.eq("organization_id", restrictOrgId);
    const { data: leadRows, error: leErr } = await qb;
    if (leErr) throw leErr;

    const emailToLead = new Map<string, { id: string; organization_id: string }>();
    for (const l of leadRows || []) {
      const em = (l.email as string).trim().toLowerCase();
      if (em && !emailToLead.has(em)) {
        emailToLead.set(em, { id: l.id as string, organization_id: l.organization_id as string });
      }
    }

    let syncedCount = 0;

    for (const msg of messages) {
      const fromEmail = msg.from?.emailAddress?.address?.toLowerCase()?.trim();
      if (!fromEmail) continue;

      const leadInfo = emailToLead.get(fromEmail);
      if (!leadInfo) continue;

      const { data: existing } = await svc.from("email_log").select("id").eq("graph_message_id", msg.id)
        .maybeSingle();
      if (existing) continue;

      const bodyHtml = msg.body?.contentType === "html" || msg.body?.contentType === "HTML"
        ? (msg.body?.content as string) || ""
        : "";
      const bodyText = (msg.bodyPreview as string) || "";

      const { data: inserted, error: insErr } = await svc.from("email_log").insert({
        lead_id: leadInfo.id,
        to_email: sender,
        from_email: fromEmail,
        from_name: msg.from?.emailAddress?.name || fromEmail,
        subject: msg.subject || "(Sin asunto)",
        body_html: bodyHtml,
        body_text: bodyText,
        direction: "inbound",
        status: "received",
        received_at: msg.receivedDateTime,
        graph_message_id: msg.id,
        conversation_id: msg.conversationId || null,
        is_read: !!msg.isRead,
        has_attachments: !!msg.hasAttachments,
        headers: { internetMessageId: msg.internetMessageId || null },
      }).select("id").single();

      if (insErr) {
        console.error("insert inbound:", insErr);
        continue;
      }

      await svc.from("lead_activities").insert({
        lead_id: leadInfo.id,
        user_id: null,
        type: "email_received",
        metadata: {
          email_log_id: inserted?.id,
          subject: msg.subject,
          from: fromEmail,
        },
      });
      syncedCount++;
    }

    const upBase = {
      last_sync_at: new Date().toISOString(),
      sync_status: "idle" as const,
      error_message: null as string | null,
    };

    if (restrictOrgId) {
      const row = syncRows?.find((r) => r.organization_id === restrictOrgId);
      await svc.from("email_sync_state").update({
        ...upBase,
        total_synced: (row?.total_synced || 0) + syncedCount,
      }).eq("organization_id", restrictOrgId).eq("mailbox_email", sender);
    } else if (syncRows && syncRows.length > 0) {
      const [first, ...rest] = syncRows;
      await svc.from("email_sync_state").update({
        ...upBase,
        total_synced: (first.total_synced || 0) + syncedCount,
      }).eq("id", first.id);
      for (const r of rest) {
        await svc.from("email_sync_state").update({ ...upBase }).eq("id", r.id);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        synced: syncedCount,
        examined: messages.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("sync-inbox-emails:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
