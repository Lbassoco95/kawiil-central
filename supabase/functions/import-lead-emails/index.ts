/**
 * Importa al lead los correos que YA existen en el buzón (bandeja de entrada y
 * enviados) para la dirección del prospecto.
 *
 * Caso de uso: un prospecto al que ya le escribimos (o que ya nos escribió)
 * desde Outlook, antes de darlo de alta en el pipeline. `sync-inbox-emails`
 * sólo mira la bandeja de entrada de los últimos días; esta función busca por
 * participante en TODO el buzón y migra el historial al lead para poder darle
 * seguimiento desde la ficha.
 *
 * Requiere: secrets AZURE_*/MICROSOFT_* (client credentials), SENDER_EMAIL y
 * permiso de aplicación Mail.Read en Azure AD.
 * Deploy: `supabase functions deploy import-lead-emails` (verify_jwt true).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MAX_PAGES = 4;
const PAGE_SIZE = 50;

async function getAppOnlyGraphToken(): Promise<string> {
  const tenant = Deno.env.get("AZURE_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const secret = Deno.env.get("AZURE_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) {
    throw new Error("Faltan AZURE_* o MICROSOFT_* para client credentials");
  }
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Token: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

type GraphMessage = {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: { contentType?: string; content?: string } | null;
  from?: { emailAddress?: { address?: string; name?: string } } | null;
  toRecipients?: Array<{ emailAddress?: { address?: string } }> | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  conversationId?: string | null;
  internetMessageId?: string | null;
  hasAttachments?: boolean | null;
  isRead?: boolean | null;
};

/**
 * Busca en todo el buzón los mensajes donde participa `leadEmail`.
 * `$search=participants:` cubre De/Para/CC/BCC y no se puede combinar con
 * `$filter`/`$orderby`, por eso se pagina con `@odata.nextLink`.
 */
async function searchMessages(
  token: string,
  mailbox: string,
  leadEmail: string,
): Promise<GraphMessage[]> {
  const select =
    "id,subject,body,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,conversationId,internetMessageId,hasAttachments,isRead";
  const search = encodeURIComponent(`"participants:${leadEmail}"`);
  let url: string | null =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages` +
    `?$search=${search}&$select=${select}&$top=${PAGE_SIZE}`;

  const out: GraphMessage[] = [];
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph search: ${err.slice(0, 400)}`);
    }
    const j = await res.json();
    if (Array.isArray(j.value)) out.push(...(j.value as GraphMessage[]));
    url = typeof j["@odata.nextLink"] === "string" ? (j["@odata.nextLink"] as string) : null;
  }
  return out;
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as { lead_id?: string; email?: string };
    if (!body.lead_id) {
      return new Response(JSON.stringify({ error: "lead_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // RLS del usuario: sólo puede importar correos de un lead que ya puede ver.
    const { data: lead, error: le } = await userClient
      .from("leads")
      .select("id, email, full_name, organization_id")
      .eq("id", body.lead_id)
      .single();
    if (le || !lead) {
      return new Response(JSON.stringify({ error: "Lead no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const leadEmail = String(body.email || lead.email || "").trim().toLowerCase();
    if (!SIMPLE_EMAIL.test(leadEmail)) {
      return new Response(
        JSON.stringify({ error: "El lead no tiene un correo válido para buscar en el buzón" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const svc = createClient(supabaseUrl, serviceKey);
    const mailbox = Deno.env.get("SENDER_EMAIL") || "contacto@kawiil.mx";
    const token = await getAppOnlyGraphToken();
    const messages = await searchMessages(token, mailbox, leadEmail);

    // Mensajes ya ligados a cualquier lead: no se vuelven a importar.
    const graphIds = messages.map((m) => m.id).filter(Boolean);
    const known = new Set<string>();
    for (let i = 0; i < graphIds.length; i += 100) {
      const chunk = graphIds.slice(i, i + 100);
      const { data: rows } = await svc
        .from("email_log")
        .select("graph_message_id")
        .in("graph_message_id", chunk);
      for (const r of rows || []) {
        if (r.graph_message_id) known.add(r.graph_message_id as string);
      }
    }

    const mailboxLower = mailbox.toLowerCase();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const msg of messages) {
      if (!msg.id) continue;
      if (known.has(msg.id)) {
        skipped++;
        continue;
      }

      const fromEmail = (msg.from?.emailAddress?.address || "").toLowerCase().trim();
      const toEmails = (msg.toRecipients || [])
        .map((r) => (r.emailAddress?.address || "").toLowerCase().trim())
        .filter(Boolean);

      // Sólo mensajes donde el prospecto es remitente o destinatario.
      const involvesLead = fromEmail === leadEmail || toEmails.includes(leadEmail);
      if (!involvesLead) {
        skipped++;
        continue;
      }

      const isOutbound = fromEmail === mailboxLower;
      const bodyIsHtml = (msg.body?.contentType || "").toLowerCase() === "html";
      const timestamp = isOutbound
        ? msg.sentDateTime || msg.receivedDateTime
        : msg.receivedDateTime || msg.sentDateTime;

      const row = {
        lead_id: lead.id,
        to_email: isOutbound ? leadEmail : mailbox,
        from_email: isOutbound ? mailbox : fromEmail,
        from_name: msg.from?.emailAddress?.name || fromEmail || mailbox,
        subject: msg.subject || "(Sin asunto)",
        body_html: bodyIsHtml ? msg.body?.content || "" : "",
        body_text: msg.bodyPreview || "",
        direction: isOutbound ? "outbound" : "inbound",
        status: isOutbound ? "sent" : "received",
        sent_at: isOutbound ? timestamp : null,
        received_at: isOutbound ? null : timestamp,
        graph_message_id: msg.id,
        conversation_id: msg.conversationId || null,
        is_read: !!msg.isRead,
        has_attachments: !!msg.hasAttachments,
        headers: { internetMessageId: msg.internetMessageId || null, imported_from: "mailbox" },
      };

      const { data: inserted, error: insErr } = await svc
        .from("email_log")
        .insert(row)
        .select("id")
        .single();
      if (insErr) {
        errors.push(insErr.message);
        continue;
      }

      await svc.from("lead_activities").insert({
        lead_id: lead.id,
        user_id: isOutbound ? user.id : null,
        type: isOutbound ? "email_sent" : "email_received",
        metadata: {
          email_log_id: inserted?.id,
          subject: msg.subject,
          from: fromEmail,
          imported_from_mailbox: true,
        },
      });

      known.add(msg.id);
      imported++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        imported,
        skipped,
        examined: messages.length,
        mailbox,
        lead_email: leadEmail,
        errors: errors.slice(0, 3),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("import-lead-emails:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
