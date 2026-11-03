/**
 * Envía un bot de Recall.ai a la llamada de una junta (Teams/Meet/Zoom).
 *
 * JWT requerido. Secret: RECALL_API_KEY (REST, región US West → us-west-2).
 * Opcional: RECALL_REGION_HOST (por defecto us-west-2.recall.ai).
 * El resultado (transcripción con hablantes) llega por mtg-recall-webhook.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOT_AVATAR_JPEG_B64 } from "./avatar.ts";
import { sendWebPushToUsers } from "../_shared/webPush.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/**
 * Segundos que espera el bot en la sala de espera antes de salirse (mínimo de Recall: 30).
 * En Teams alguien debe admitirlo desde el lobby; 30 s no alcanza en la práctica.
 */
const WAITING_ROOM_TIMEOUT_SEC = 600;

/**
 * Estados del bot en los que no se debe enviar otro. `call_ended` NO va aquí:
 * el bot ya salió de la llamada (solo falta procesar), y bloquearlo impedía reenviarlo.
 */
const ACTIVE_BOT = new Set([
  "joining_call",
  "in_waiting_room",
  "in_call_not_recording",
  "in_call_recording",
]);

/** Recall responde sin créditos con 402 (o un 4xx cuyo texto habla de créditos/facturación). */
function looksLikeNoCredits(status: number, body: string): boolean {
  if (status === 402) return true;
  return status >= 400 && status < 500 && /credit|billing|payment|insufficient|balance|quota/i.test(body);
}

/** Avisa en la app (y por push) a administradores y gerentes para que recarguen antes de la próxima junta. */
async function notifyRecallNoCredits(
  admin: ReturnType<typeof createClient>,
  meeting: { id: string; organization_id: string },
) {
  try {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id")
      .eq("organization_id", meeting.organization_id);
    const ids = (profiles ?? []).map((p: { user_id: string }) => p.user_id);
    if (ids.length === 0) return;
    const { data: roles } = await admin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids)
      .in("role", ["admin", "gerente"]);
    const targets = [...new Set((roles ?? []).map((r: { user_id: string }) => r.user_id))];
    if (targets.length === 0) return;

    // Una alerta por día y por usuario: evita spamear si varios intentan enviar el bot.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await admin
      .from("notifications")
      .select("user_id")
      .eq("type", "recall_sin_creditos")
      .in("user_id", targets)
      .gte("created_at", since);
    const already = new Set((recent ?? []).map((n: { user_id: string }) => n.user_id));
    const pending = targets.filter((uid) => !already.has(uid));
    if (pending.length === 0) return;

    const appOrigin =
      (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "").replace(/\/$/, "") ||
      "https://app.kawiil.com";
    const title = "Kawiilito sin créditos en Recall";
    const body = "No se pudo enviar a Kawiilito a una junta. Recarga créditos en Recall para que vuelva a grabar.";
    await admin.from("notifications").insert(
      pending.map((uid) => ({
        user_id: uid,
        organization_id: meeting.organization_id,
        type: "recall_sin_creditos",
        title,
        body,
        entity_type: "meeting",
        entity_id: meeting.id,
        is_read: false,
      })),
    );
    await sendWebPushToUsers(admin as never, {
      userIds: pending,
      title,
      body,
      url: `${appOrigin}/juntas/${meeting.id}`,
      tag: "recall-sin-creditos",
    });
  } catch (e) {
    console.warn("[mtg-recall-join] no se pudo avisar de créditos:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const recallKey = Deno.env.get("RECALL_API_KEY");
    if (!recallKey) {
      return json(
        { error: "RECALL_API_KEY no configurada en Edge Functions secrets", code: "recall_not_configured" },
        503,
      );
    }
    const host = Deno.env.get("RECALL_REGION_HOST") || "us-west-2.recall.ai";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const meetingId = String(body?.meeting_id || "").trim();
    if (!meetingId) return json({ error: "meeting_id requerido" }, 400);

    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .single();
    if (!profile?.organization_id) return json({ error: "sin organización" }, 400);

    const { data: meeting, error: mErr } = await admin
      .from("mtg_meetings")
      .select("id, organization_id, series_id, teams_join_url, recall_bot_id, recall_bot_status, transcript_path")
      .eq("id", meetingId)
      .single();
    if (mErr || !meeting) return json({ error: "junta no encontrada" }, 404);
    if (meeting.organization_id !== profile.organization_id) return json({ error: "forbidden" }, 403);
    if (!meeting.teams_join_url) {
      return json({ error: "La junta no tiene link de llamada. Pégalo primero." }, 400);
    }
    if (
      meeting.recall_bot_id &&
      meeting.recall_bot_status &&
      ACTIVE_BOT.has(meeting.recall_bot_status) &&
      body?.force !== true
    ) {
      return json(
        { error: "Ya hay un bot en esta llamada", code: "bot_active", status: meeting.recall_bot_status },
        409,
      );
    }

    const resp = await fetch(`https://${host}/api/v1/bot/`, {
      method: "POST",
      headers: { Authorization: `Token ${recallKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        meeting_url: meeting.teams_join_url,
        bot_name: "Kawiilito",
        // Strings de nivel superior: regresan en data.bot.metadata de cada webhook.
        metadata: { meeting_id: meeting.id, organization_id: meeting.organization_id },
        automatic_leave: { waiting_room_timeout: WAITING_ROOM_TIMEOUT_SEC },
        automatic_video_output: {
          in_call_recording: { kind: "jpeg", b64_data: BOT_AVATAR_JPEG_B64 },
        },
        recording_config: {
          transcript: { provider: { recallai_streaming: { language_code: "auto" } } },
          // Video mezclado (mp4) para poder ver la llamada; se consulta con mtg-recall-media.
          video_mixed_mp4: {},
        },
      }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error("recall create bot", resp.status, text.slice(0, 400));
      const noCredits = looksLikeNoCredits(resp.status, text);
      if (noCredits) {
        await notifyRecallNoCredits(admin, meeting);
      }
      return json(
        noCredits
          ? {
              error:
                "Kawiilito no puede entrar: la cuenta de Recall se quedó sin créditos. Graba con «Audio de llamada» o en Teams y avisa a un administrador para recargar.",
              code: "recall_no_credits",
              status: resp.status,
              details: text.slice(0, 400),
            }
          : { error: "Recall rechazó la creación del bot", status: resp.status, details: text.slice(0, 400) },
        noCredits ? 402 : 502,
      );
    }
    const bot = JSON.parse(text);

    await admin
      .from("mtg_meetings")
      .update({
        recall_bot_id: bot.id,
        recall_bot_status: "joining_call",
        // No pisar una transcripción ya recibida (p. ej. al reenviar el bot).
        ...(meeting.transcript_path
          ? {}
          : { transcript_status: "subscribed", transcript_unavailable_reason: null }),
      })
      .eq("id", meetingId);

    await admin.from("mtg_audit_log").insert({
      organization_id: meeting.organization_id,
      actor_user_id: userId,
      entity_type: "meeting",
      entity_id: meetingId,
      action: "recall_bot_sent",
      details: { bot_id: bot.id, region: host },
    });

    return json({ ok: true, bot_id: bot.id });
  } catch (e) {
    console.error("mtg-recall-join", e);
    return json({ error: e instanceof Error ? e.message : "error desconocido" }, 500);
  }
});
