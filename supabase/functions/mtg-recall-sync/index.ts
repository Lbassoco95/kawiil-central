/**
 * Trae a mano lo que Recall tiene de la llamada de una junta: estado real del bot,
 * y, si ya terminó, la transcripción con hablantes y la minuta.
 * Sirve cuando un webhook no llegó (p. ej. el estado se quedó en in_call_not_recording).
 *
 * JWT requerido. Secret: RECALL_API_KEY. Opcional: RECALL_REGION_HOST.
 * Body: { meeting_id, force?, leave? }. force=true vuelve a bajar la transcripción aunque ya exista;
 * leave=true saca al bot de la llamada (POST /bot/{id}/leave_call/, irreversible) antes de leer.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOT_LEFT_STATUSES, endMeetingFromBot, processTranscript } from "../_shared/recallTranscript.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const recallKey = Deno.env.get("RECALL_API_KEY");
    if (!recallKey) return json({ error: "RECALL_API_KEY no configurada" }, 503);
    const host = Deno.env.get("RECALL_REGION_HOST") || "us-west-2.recall.ai";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const meetingId = String(body?.meeting_id || "").trim();
    if (!meetingId) return json({ error: "meeting_id requerido" }, 400);

    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userData.user.id)
      .single();
    const { data: meeting } = await admin
      .from("mtg_meetings")
      .select("id, organization_id, series_id, client_id, transcript_path, recall_bot_id")
      .eq("id", meetingId)
      .single();
    if (!meeting) return json({ error: "junta no encontrada" }, 404);
    if (!profile?.organization_id || meeting.organization_id !== profile.organization_id) {
      return json({ error: "forbidden" }, 403);
    }
    if (!meeting.recall_bot_id) return json({ error: "Esta junta no tiene bot de Kawiilito" }, 404);
    const botId = meeting.recall_bot_id as string;

    const wantLeave = body?.leave === true;
    if (wantLeave) {
      const lv = await fetch(`https://${host}/api/v1/bot/${botId}/leave_call/`, {
        method: "POST",
        headers: { Authorization: `Token ${recallKey}` },
      });
      // 400 = el bot ya no estaba en una llamada: no es un error para quien pidió salir.
      if (!lv.ok && lv.status !== 400) {
        return json({ error: `Recall no pudo sacar al bot (${lv.status})` }, 502);
      }
    }

    // deno-lint-ignore no-explicit-any
    const readBot = async (): Promise<{ bot: any; status: string | null } | Response> => {
      const r = await fetch(`https://${host}/api/v1/bot/${botId}/`, {
        headers: { Authorization: `Token ${recallKey}` },
      });
      if (!r.ok) return json({ error: `Recall respondió ${r.status}` }, 502);
      const b = await r.json();
      const ch: { code?: string }[] = Array.isArray(b.status_changes) ? b.status_changes : [];
      return { bot: b, status: ch.length ? (ch[ch.length - 1].code ?? null) : null };
    };

    let read = await readBot();
    if (read instanceof Response) return read;
    // Recall tarda unos segundos en reflejar la salida y en dejar lista la transcripción.
    for (let i = 0; wantLeave && i < 8; i++) {
      const done = !!read.status && BOT_LEFT_STATUSES.has(read.status);
      // deno-lint-ignore no-explicit-any
      const hasT = (read.bot.recordings ?? []).some((r: any) => r?.media_shortcuts?.transcript?.data?.download_url);
      if (done && hasT) break;
      await new Promise((res) => setTimeout(res, 3000));
      const next = await readBot();
      if (next instanceof Response) return next;
      read = next;
    }
    const { bot, status } = read;

    const left = !!status && BOT_LEFT_STATUSES.has(status);
    // Quien pidió sacar al bot quiere cerrar la junta aunque Recall aún no confirme la salida.
    const leaving = wantLeave && !left;
    const shownStatus = leaving ? "leaving" : status;
    if (shownStatus) {
      await admin.from("mtg_meetings").update({ recall_bot_status: shownStatus }).eq("id", meeting.id);
    }
    let ended = false;
    if (left || wantLeave) ended = await endMeetingFromBot(admin, meeting, botId);

    // deno-lint-ignore no-explicit-any
    const hasTranscript = (bot.recordings ?? []).some((r: any) => r?.media_shortcuts?.transcript?.data?.download_url);
    let transcriptSaved = false;
    if (hasTranscript && (!meeting.transcript_path || body?.force === true)) {
      await processTranscript(admin, meeting, botId);
      transcriptSaved = true;
    }

    return json({
      ok: true,
      bot_status: status,
      bot_left: left,
      leaving,
      meeting_ended: ended,
      transcript_saved: transcriptSaved,
      has_transcript: hasTranscript,
    });
  } catch (e) {
    console.error("mtg-recall-sync", e);
    return json({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});
