// Envía un DM de Slack al G4 responsable cuando un colaborador registra un
// día de burnout o solicita un permiso. Pensado para invocarse (best-effort)
// justo después de crear la solicitud desde el cliente.
//
// Resuelve el destinatario igual que el ruteo interno de aprobación:
//   - assigned_approver_user_id (responsable de célula → aprobador por defecto)
//   - si es NULL (el solicitante sería su propio aprobador): todos los G4 salvo él.
//
// Requiere los secretos: SLACK_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY. El bot necesita scope chat:write (e im:write para DMs).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Solo notificamos estos dos tipos por Slack (decisión de producto).
const NOTIFY_TYPES = new Set(["burnout", "permiso"]);

const TYPE_LABEL: Record<string, string> = {
  burnout: "Día de burnout",
  permiso: "Permiso",
  vacaciones: "Vacaciones",
  dia_personal: "Día personal",
  incapacidad: "Incapacidad",
  evento_escolar_familiar: "Evento escolar/familiar",
};

const DAY_PART_LABEL: Record<string, string> = {
  full_day: "Día completo",
  morning: "Medio día (mañana)",
  afternoon: "Medio día (tarde)",
};

function fmt(dateStr: string): string {
  // dateStr viene como YYYY-MM-DD; lo mostramos DD/MM.
  const [y, m, d] = dateStr.split("-");
  return d && m ? `${d}/${m}` : dateStr;
}

function rangeLabel(start: string, end: string): string {
  return start === end ? fmt(start) : `${fmt(start)}–${fmt(end)}`;
}

async function dmToSlackUser(token: string, slackUserId: string, text: string, blocks: unknown[]) {
  // Pasar el user_id como channel hace que Slack abra/use el DM con el bot.
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: slackUserId, text, blocks }),
  });
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!SLACK_BOT_TOKEN) return json({ error: "SLACK_BOT_TOKEN no configurado" }, 500);

    const { request_id } = await req.json().catch(() => ({ request_id: null }));
    if (!request_id) return json({ error: "request_id requerido" }, 400);

    // Verifica que quien invoca sea el solicitante (evita disparos arbitrarios).
    const authHeader = req.headers.get("Authorization") ?? "";
    const requester = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await requester.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: reqRow, error: reqErr } = await admin
      .from("rh_absence_requests")
      .select("id, user_id, organization_id, absence_type, start_date, end_date, day_part, reason, assigned_approver_user_id")
      .eq("id", request_id)
      .maybeSingle();

    if (reqErr) return json({ error: reqErr.message }, 500);
    if (!reqRow) return json({ error: "Solicitud no encontrada" }, 404);
    if (reqRow.user_id !== user.id) return json({ error: "Forbidden" }, 403);
    if (!NOTIFY_TYPES.has(reqRow.absence_type)) return json({ ok: true, skipped: "tipo no notificable" });

    // Nombre del solicitante + si es G4.
    const { data: prof } = await admin
      .from("profiles").select("full_name").eq("user_id", reqRow.user_id).maybeSingle();
    const requesterName = prof?.full_name || "Un colaborador";

    const { data: g4row } = await admin
      .from("user_roles").select("user_id").eq("user_id", reqRow.user_id).eq("role", "transformador").maybeSingle();
    const requesterIsG4 = !!g4row;

    // Resolver destinatarios (mismos criterios que el ruteo interno de aprobación).
    let targetUserIds: string[] = [];
    if (reqRow.assigned_approver_user_id) {
      targetUserIds = [reqRow.assigned_approver_user_id];
    } else {
      // Todos los G4 (transformador) de la organización, salvo el solicitante.
      const { data: g4s } = await admin
        .from("user_roles").select("user_id").eq("role", "transformador");
      const g4Ids = (g4s ?? []).map((r: { user_id: string }) => r.user_id);
      if (g4Ids.length > 0) {
        const { data: profs } = await admin
          .from("profiles")
          .select("user_id")
          .eq("organization_id", reqRow.organization_id)
          .in("user_id", g4Ids);
        targetUserIds = (profs ?? [])
          .map((p: { user_id: string }) => p.user_id)
          .filter((id: string) => id !== reqRow.user_id);
      }
    }

    if (targetUserIds.length === 0) return json({ ok: true, skipped: "sin G4 destinatario" });

    // Mapear cada G4 a su slack_user_id.
    const { data: conns } = await admin
      .from("user_slack_connections")
      .select("user_id, slack_user_id")
      .in("user_id", targetUserIds);

    const slackIds = (conns ?? [])
      .map((c: { slack_user_id: string | null }) => c.slack_user_id)
      .filter((s: string | null): s is string => !!s);

    if (slackIds.length === 0) {
      return json({ ok: true, skipped: "G4 sin Slack conectado", targets: targetUserIds.length });
    }

    const isBurnout = reqRow.absence_type === "burnout";
    const typeLabel = TYPE_LABEL[reqRow.absence_type] ?? reqRow.absence_type;
    const range = rangeLabel(reqRow.start_date, reqRow.end_date);
    const dayPart = DAY_PART_LABEL[reqRow.day_part] ?? reqRow.day_part;
    const nameLine = requesterName + (requesterIsG4 ? " (G4)" : "");

    const headerText = isBurnout
      ? "🌿 Día de burnout registrado"
      : "📄 Nueva solicitud de permiso";
    const footNote = isBurnout
      ? "Se aprobó automáticamente. Es solo un aviso para que sepas que estará fuera."
      : "Requiere tu aprobación en Kawiil → RH › Solicitudes.";
    const text = `${headerText}: ${nameLine} · ${range}`;

    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: headerText, emoji: true } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Colaborador:*\n${nameLine}` },
          { type: "mrkdwn", text: `*Tipo:*\n${typeLabel}` },
          { type: "mrkdwn", text: `*Fecha:*\n${range}` },
          { type: "mrkdwn", text: `*Jornada:*\n${dayPart}` },
        ],
      },
      ...(reqRow.reason
        ? [{ type: "section", text: { type: "mrkdwn", text: `*Motivo:*\n${reqRow.reason}` } }]
        : []),
      { type: "context", elements: [{ type: "mrkdwn", text: footNote }] },
    ];

    let sent = 0;
    const errors: string[] = [];
    for (const slackId of slackIds) {
      try {
        const r = await dmToSlackUser(SLACK_BOT_TOKEN, slackId, text, blocks);
        if (r.ok) sent++;
        else errors.push(`${slackId}: ${r.error}`);
      } catch (e) {
        errors.push(`${slackId}: ${String(e)}`);
      }
    }

    return json({ ok: true, sent, targets: slackIds.length, errors });
  } catch (e) {
    console.error("rh-absence-slack-notify error:", e);
    return json({ error: String(e) }, 500);
  }
});
