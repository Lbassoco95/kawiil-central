import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_PREFER_IMMUTABLE = { Prefer: 'IdType="ImmutableId"' } as const;

type Svc = ReturnType<typeof createClient>;

async function refreshTokenIfNeeded(supabaseAdmin: Svc, userId: string, tokenRow: Record<string, unknown>) {
  const expiresAt = new Date(String(tokenRow.expires_at));
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return String(tokenRow.access_token);
  }

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!.trim();

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: String(tokenRow.refresh_token),
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  const newExpiresAt = new Date(Date.now() + (data.expires_in as number) * 1000).toISOString();

  await supabaseAdmin
    .from("microsoft_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRow.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return data.access_token as string;
}

async function getAccessToken(svc: Svc, userId: string): Promise<string> {
  const { data: tokenRow, error: tokenError } = await svc
    .from("microsoft_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (tokenError || !tokenRow) {
    throw new Error("Microsoft no conectado para este usuario");
  }

  return await refreshTokenIfNeeded(svc, userId, tokenRow as Record<string, unknown>);
}

/**
 * Correo nuevo programado desde el redactor (kind = 'send_new'): no hay borrador, así que se
 * arma el mensaje con el payload y se envía con /me/sendMail. El payload guarda los
 * destinatarios ya en formato Graph (to_recipients, cc_recipients, bcc_recipients).
 */
async function processSendNewJob(svc: Svc, userId: string, payload: Record<string, unknown>) {
  const accessToken = await getAccessToken(svc, userId);

  const toRecipients = Array.isArray(payload.to_recipients) ? payload.to_recipients : [];
  if (toRecipients.length === 0) throw new Error("El envío programado no tiene destinatarios");

  const message: Record<string, unknown> = {
    subject: typeof payload.subject === "string" && payload.subject ? payload.subject : "(Sin asunto)",
    body: {
      contentType: "HTML",
      content: typeof payload.body_html === "string" && payload.body_html ? payload.body_html : "<p></p>",
    },
    toRecipients,
  };
  if (Array.isArray(payload.cc_recipients) && payload.cc_recipients.length > 0) {
    message.ccRecipients = payload.cc_recipients;
  }
  if (Array.isArray(payload.bcc_recipients) && payload.bcc_recipients.length > 0) {
    message.bccRecipients = payload.bcc_recipients;
  }
  if (payload.is_delivery_receipt_requested === true) message.isDeliveryReceiptRequested = true;
  if (payload.is_read_receipt_requested === true) message.isReadReceiptRequested = true;

  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const fileAttachments = attachments.flatMap((raw) => {
    const att = raw as Record<string, unknown>;
    const name = typeof att.name === "string" ? att.name : "";
    const contentBytes = typeof att.contentBytes === "string" ? att.contentBytes : "";
    if (!name || !contentBytes) return [];
    return [{
      "@odata.type": "#microsoft.graph.fileAttachment",
      name,
      contentType: typeof att.contentType === "string" ? att.contentType : "application/octet-stream",
      contentBytes,
    }];
  });
  if (fileAttachments.length > 0) message.attachments = fileAttachments;

  const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...GRAPH_PREFER_IMMUTABLE,
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Enviar [${res.status}]: ${errBody.slice(0, 500)}`);
  }
}

async function processSendDraftJob(
  svc: Svc,
  userId: string,
  draftId: string,
  payload: Record<string, unknown>,
) {
  const accessToken = await getAccessToken(svc, userId);

  const patch: Record<string, unknown> = {};
  const bodyHtml = typeof payload.body_html === "string" ? payload.body_html : "";
  if (bodyHtml) {
    patch.body = { contentType: "HTML", content: bodyHtml };
  }
  if ("to_recipients" in payload && Array.isArray(payload.to_recipients)) {
    patch.toRecipients = payload.to_recipients;
  }
  if ("cc_recipients" in payload && Array.isArray(payload.cc_recipients)) {
    patch.ccRecipients = payload.cc_recipients;
  }
  if ("bcc_recipients" in payload && Array.isArray(payload.bcc_recipients)) {
    patch.bccRecipients = payload.bcc_recipients;
  }

  if (payload.is_delivery_receipt_requested === true) {
    patch.isDeliveryReceiptRequested = true;
  }
  if (payload.is_read_receipt_requested === true) {
    patch.isReadReceiptRequested = true;
  }

  if (Object.keys(patch).length > 0) {
    const res = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...GRAPH_PREFER_IMMUTABLE,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Actualizar borrador [${res.status}]: ${errBody.slice(0, 500)}`);
    }
  }

  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  for (const raw of attachments) {
    const att = raw as Record<string, unknown>;
    const name = typeof att.name === "string" ? att.name : "";
    const contentBytes = typeof att.contentBytes === "string" ? att.contentBytes : "";
    if (!name || !contentBytes) continue;

    const r = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...GRAPH_PREFER_IMMUTABLE,
      },
      body: JSON.stringify({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name,
        contentType: typeof att.contentType === "string" ? att.contentType : "application/octet-stream",
        contentBytes,
      }),
    });
    if (!r.ok) {
      const errBody = await r.text();
      throw new Error(`Adjunto ${name} [${r.status}]: ${errBody.slice(0, 300)}`);
    }
  }

  const sres = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, ...GRAPH_PREFER_IMMUTABLE },
  });
  if (!sres.ok) {
    const errBody = await sres.text();
    throw new Error(`Enviar [${sres.status}]: ${errBody.slice(0, 500)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const headerSecret = req.headers.get("x-cron-secret");
    if (!cronSecret || headerSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const nowIso = new Date().toISOString();
    const { data: candidates, error: qe } = await svc
      .from("scheduled_mail_jobs")
      .select("id, user_id, draft_id, kind, payload, status")
      .eq("status", "pending")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(40);

    if (qe) throw qe;

    let processed = 0;
    let failed = 0;

    for (const row of candidates ?? []) {
      const { data: locked, error: le } = await svc
        .from("scheduled_mail_jobs")
        .update({ status: "processing" })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id, user_id, draft_id, kind, payload")
        .maybeSingle();

      if (le || !locked) continue;

      try {
        const payload = (locked.payload && typeof locked.payload === "object"
          ? locked.payload
          : {}) as Record<string, unknown>;

        if (locked.kind === "send_draft") {
          await processSendDraftJob(svc, locked.user_id as string, locked.draft_id as string, payload);
        } else if (locked.kind === "send_new") {
          await processSendNewJob(svc, locked.user_id as string, payload);
        } else {
          throw new Error(`Tipo de trabajo no soportado: ${locked.kind}`);
        }

        await svc
          .from("scheduled_mail_jobs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", locked.id);
        processed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await svc
          .from("scheduled_mail_jobs")
          .update({
            status: "failed",
            error_message: msg.slice(0, 2000),
          })
          .eq("id", locked.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, failed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-scheduled-mail", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
