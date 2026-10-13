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

/** Estados del bot en los que no se debe enviar otro. */
const ACTIVE_BOT = new Set([
  "joining_call",
  "in_waiting_room",
  "in_call_not_recording",
  "in_call_recording",
  "call_ended",
]);

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
      .select("id, organization_id, series_id, teams_join_url, recall_bot_id, recall_bot_status")
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
        automatic_video_output: {
          in_call_recording: { kind: "jpeg", b64_data: BOT_AVATAR_JPEG_B64 },
        },
        recording_config: {
          transcript: { provider: { recallai_streaming: { language_code: "auto" } } },
        },
      }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error("recall create bot", resp.status, text.slice(0, 400));
      return json({ error: "Recall rechazó la creación del bot", status: resp.status, details: text.slice(0, 400) }, 502);
    }
    const bot = JSON.parse(text);

    await admin
      .from("mtg_meetings")
      .update({
        recall_bot_id: bot.id,
        recall_bot_status: "joining_call",
        transcript_status: "subscribed",
        transcript_unavailable_reason: null,
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
