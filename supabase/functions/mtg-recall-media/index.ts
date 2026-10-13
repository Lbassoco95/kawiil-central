/**
 * Devuelve una URL temporal (prefirmada por Recall) para ver/descargar la
 * grabación de la llamada que grabó Kawiilito.
 *
 * JWT requerido. Secret: RECALL_API_KEY. Opcional: RECALL_REGION_HOST.
 * Body: { meeting_id }. Respuesta: { video_url?, audio_url?, expires_note }.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      .select("id, organization_id, recall_bot_id")
      .eq("id", meetingId)
      .single();
    if (!meeting) return json({ error: "junta no encontrada" }, 404);
    if (!profile?.organization_id || meeting.organization_id !== profile.organization_id) {
      return json({ error: "forbidden" }, 403);
    }
    if (!meeting.recall_bot_id) return json({ error: "Esta junta no tiene bot de Kawiilito" }, 404);

    const resp = await fetch(`https://${host}/api/v1/bot/${meeting.recall_bot_id}/`, {
      headers: { Authorization: `Token ${recallKey}` },
    });
    if (!resp.ok) return json({ error: `Recall respondió ${resp.status}` }, 502);
    const bot = await resp.json();
    const shortcuts = (bot.recordings ?? []).map((r: any) => r?.media_shortcuts ?? {});
    const video = shortcuts.map((s: any) => s?.video_mixed?.data?.download_url).find(Boolean) ?? null;
    const audio = shortcuts.map((s: any) => s?.audio_mixed?.data?.download_url).find(Boolean) ?? null;
    if (!video && !audio) {
      return json(
        {
          error:
            "Esta llamada se grabó solo con transcripción (sin video). Las próximas llamadas con Kawiilito sí guardarán video.",
          code: "no_media",
        },
        404,
      );
    }
    return json({
      video_url: video,
      audio_url: audio,
      expires_note: "El enlace es temporal; vuelve a abrir la grabación si caduca.",
    });
  } catch (e) {
    console.error("mtg-recall-media", e);
    return json({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});
