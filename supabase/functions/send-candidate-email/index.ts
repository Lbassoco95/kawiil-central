// Envío de correo a un candidato usando Microsoft Graph (token del usuario que invoca).
// Registro automático en la bitácora del candidato (rh_candidate_activities, tipo 'email').
//
// Contrato:
//   POST { candidate_id, subject, body, overrides? }
//   200  { message_id, comunicacion_id }
//   4xx  { error }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

async function getAccessToken(admin: any, userId: string): Promise<string> {
  const { data: tokenRow } = await admin
    .from("microsoft_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!tokenRow?.access_token) {
    throw new Error("El usuario no tiene Microsoft conectado. Conecta tu cuenta en Configuración.");
  }

  const expiresAt = new Date(tokenRow.expires_at);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  // Refresh token
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!.trim();

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: "refresh_token",
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`No se pudo renovar el token de Microsoft: ${data?.error_description ?? res.status}`);

  await admin
    .from("microsoft_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRow.refresh_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    })
    .eq("user_id", userId);

  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json({ error: "No autorizado" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const candidateId = String(body.candidate_id ?? "").trim();
    if (!candidateId) return json({ error: "Falta candidate_id" }, 400);

    // Candidato
    const { data: cand } = await admin
      .from("rh_candidates")
      .select("id, organization_id, full_name, email, stage_id, process_id")
      .eq("id", candidateId)
      .maybeSingle();
    if (!cand) return json({ error: "Candidato no encontrado" }, 404);
    if (!cand.email) return json({ error: "El candidato no tiene correo registrado." }, 400);

    // Verificar que el que envía pertenece a la misma organización
    const { data: prof } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!prof || prof.organization_id !== cand.organization_id) {
      return json({ error: "No tienes acceso a este candidato." }, 403);
    }

    // Variables para sustitución
    const [{ data: stage }, { data: proc }, { data: org }] = await Promise.all([
      cand.stage_id
        ? admin.from("rh_recruitment_stages").select("name").eq("id", cand.stage_id).maybeSingle()
        : Promise.resolve({ data: null }),
      cand.process_id
        ? admin.from("rh_recruitment_processes").select("title").eq("id", cand.process_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("organizations").select("name").eq("id", cand.organization_id).maybeSingle(),
    ]);

    const vars: Record<string, string> = {
      nombre: cand.full_name.split(" ")[0] ?? cand.full_name,
      nombre_completo: cand.full_name,
      correo: cand.email,
      vacante: proc?.title ?? "",
      fase: stage?.name ?? "",
      etapa: stage?.name ?? "",
      empresa: org?.name ?? "",
    };

    const subject = renderTemplate(String(body.overrides?.asunto ?? body.subject ?? "").trim(), vars);
    const rawBody = renderTemplate(String(body.overrides?.cuerpo ?? body.body ?? ""), vars);
    if (!subject || !rawBody.trim()) {
      return json({ error: "Asunto y mensaje son obligatorios." }, 400);
    }

    const htmlBody = rawBody.replace(/\n/g, "<br>");

    // Obtener token de Microsoft del usuario
    const accessToken = await getAccessToken(admin, caller.id);

    // Enviar vía Microsoft Graph /me/sendMail
    const graphRes = await fetch(`${GRAPH_BASE}/me/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: htmlBody },
          toRecipients: [{ emailAddress: { address: cand.email, name: cand.full_name } }],
        },
        saveToSentItems: true,
      }),
    });

    if (!graphRes.ok) {
      const errText = await graphRes.text().catch(() => `HTTP ${graphRes.status}`);
      console.error("Microsoft Graph sendMail error:", errText);
      return json({ error: `No se pudo enviar el correo: ${errText.slice(0, 300)}` }, 502);
    }

    // messageId sintético (Graph /sendMail no devuelve ID del mensaje enviado)
    const messageId = `graph-${Date.now()}`;

    // Registro en bitácora SOLO si el envío fue exitoso
    const { data: activity, error: logErr } = await admin
      .from("rh_candidate_activities")
      .insert({
        organization_id: cand.organization_id,
        candidate_id: cand.id,
        activity_type: "email",
        content: `Correo enviado: ${subject}`,
        metadata: { subject, to: cand.email, message_id: messageId, provider: "microsoft-graph" },
        created_by: caller.id,
      })
      .select("id")
      .single();
    if (logErr) console.error("No se pudo registrar en bitácora:", logErr.message);

    return json({ message_id: messageId, comunicacion_id: activity?.id ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("send-candidate-email error:", message);
    return json({ error: message }, 500);
  }
});
