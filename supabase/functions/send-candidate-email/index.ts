// Envío de correo a un candidato desde el remitente corporativo (rh@kawiil.mx)
// vía Resend, con registro automático en la bitácora del candidato
// (rh_candidate_activities, tipo 'email'). Reemplaza el flujo anterior que
// enviaba desde el Outlook del usuario.
//
// Secrets requeridos en Edge Functions:
//   RESEND_API_KEY  (re_...)
//   FROM_EMAIL      (rh@kawiil.mx — dominio verificado en Resend)
//   FROM_NAME       (Kawiil RH)
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identidad del que llama.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json({ error: "No autorizado" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const candidateId = String(body.candidate_id ?? "").trim();
    if (!candidateId) return json({ error: "Falta candidate_id" }, 400);

    // Candidato (recipiente desde el servidor; no se confía en el cliente).
    const { data: cand } = await admin
      .from("rh_candidates")
      .select("id, organization_id, full_name, email, stage_id, process_id")
      .eq("id", candidateId)
      .maybeSingle();
    if (!cand) return json({ error: "Candidato no encontrado" }, 404);
    if (!cand.email) return json({ error: "El candidato no tiene correo registrado." }, 400);

    // El que envía debe pertenecer a la misma organización que el candidato.
    const { data: prof } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!prof || prof.organization_id !== cand.organization_id) {
      return json({ error: "No tienes acceso a este candidato." }, 403);
    }

    // Variables para sustitución (red de seguridad; el frontend ya las resuelve).
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
    const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937">${escapeHtml(rawBody).replace(/\n/g, "<br>")}</div>`;

    // --- Envío vía Resend ---
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL");
    const fromName = Deno.env.get("FROM_NAME") || "Kawiil RH";
    if (!apiKey || !fromEmail) {
      return json({ error: "Email no configurado (faltan RESEND_API_KEY / FROM_EMAIL en Secrets)." }, 500);
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [cand.email],
        subject,
        html,
        reply_to: fromEmail,
      }),
    });

    const resendJson = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok || !resendJson?.id) {
      const msg = resendJson?.message || resendJson?.error || `Resend respondió ${resendRes.status}`;
      console.error("Resend error:", msg);
      return json({ error: `No se pudo enviar el correo: ${msg}` }, 502);
    }
    const messageId = resendJson.id as string;

    // --- Registro en bitácora SOLO si el envío fue exitoso ---
    const { data: activity, error: logErr } = await admin
      .from("rh_candidate_activities")
      .insert({
        organization_id: cand.organization_id,
        candidate_id: cand.id,
        activity_type: "email",
        content: `Correo enviado: ${subject}`,
        metadata: { subject, to: cand.email, message_id: messageId, provider: "resend" },
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
