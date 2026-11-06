/**
 * Webhook de Recall.ai para el bot de juntas.
 *
 * verify_jwt = false: la autenticidad se valida con la firma Standard Webhooks
 * (headers webhook-id / webhook-timestamp / webhook-signature; cuentas antiguas
 * usan svix-*). Secret: RECALL_WEBHOOK_SECRET (whsec_...).
 *
 * - bot.* → actualiza recall_bot_status.
 * - transcript.done → baja transcripción con hablantes y asistentes, genera VTT
 *   con <v Nombre>, lo guarda en bucket mtg y encola mtg.generate_minutes.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOT_LEFT_STATUSES, endMeetingFromBot, processTranscript } from "../_shared/recallTranscript.ts";

const TOLERANCE_SEC = 5 * 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verifySignature(req: Request, raw: string, secret: string): Promise<boolean> {
  const h = req.headers;
  const id = h.get("webhook-id") ?? h.get("svix-id");
  const ts = h.get("webhook-timestamp") ?? h.get("svix-timestamp");
  const sigHeader = h.get("webhook-signature") ?? h.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > TOLERANCE_SEC) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    b64ToBytes(secret.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // Header: "v1,<sig> v1,<sig2>" (varias firmas durante rotación).
  return sigHeader.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    return ver === "v1" && !!sig && safeEqual(sig, expected);
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = Deno.env.get("RECALL_WEBHOOK_SECRET");
  if (!secret) return json({ error: "RECALL_WEBHOOK_SECRET no configurada" }, 503);

  const raw = await req.text();
  let valid = false;
  try {
    valid = await verifySignature(req, raw, secret);
  } catch (e) {
    console.error("mtg-recall-webhook signature", e);
  }
  if (!valid) return json({ error: "invalid signature" }, 401);

  const evt = JSON.parse(raw) as { event?: string; data?: { bot?: { id?: string; metadata?: Record<string, string> }; data?: { code?: string; sub_code?: string | null } } };
  const event = evt.event ?? "";
  const botId = evt.data?.bot?.id;
  if (!botId) return json({ ok: true, ignored: "sin bot id" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cols = "id, organization_id, series_id, client_id, transcript_path, recall_bot_id";
  let { data: meeting } = await admin.from("mtg_meetings").select(cols).eq("recall_bot_id", botId).maybeSingle();
  // Si la junta ya apunta a otro bot (reenvío), se resuelve por el metadata del bot.
  if (!meeting && evt.data?.bot?.metadata?.meeting_id) {
    ({ data: meeting } = await admin.from("mtg_meetings").select(cols).eq("id", evt.data.bot.metadata.meeting_id).maybeSingle());
  }
  if (!meeting) return json({ ok: true, ignored: "bot sin junta" });
  // Solo el bot vigente actualiza el estado; los bots anteriores solo aportan su transcripción.
  const isCurrent = meeting.recall_bot_id === botId;

  try {
    if (event.startsWith("bot.") && isCurrent) {
      const status = event.slice(4);
      await admin.from("mtg_meetings").update({ recall_bot_status: status }).eq("id", meeting.id);
      // Terminó la llamada: el bot se desconecta y la junta se da por terminada.
      if (BOT_LEFT_STATUSES.has(status)) await endMeetingFromBot(admin, meeting, botId);
      if (status === "fatal" && !meeting.transcript_path) {
        const sub = evt.data?.data?.sub_code ?? evt.data?.data?.code ?? "fatal";
        await admin
          .from("mtg_meetings")
          .update({
            transcript_status: "failed",
            transcript_unavailable_reason: (sub === "timeout_exceeded_waiting_room"
              ? "Kawiilito no fue admitido a tiempo en la llamada"
              : `Recall bot falló: ${sub}`).slice(0, 240),
          })
          .eq("id", meeting.id);
      }
    } else if (event === "transcript.done") {
      await processTranscript(admin, meeting, botId);
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("mtg-recall-webhook", event, msg);
    await admin
      .from("mtg_meetings")
      .update({ transcript_status: "failed", transcript_unavailable_reason: `Recall: ${msg}`.slice(0, 240) })
      .eq("id", meeting.id);
    // 500 → Recall reintenta.
    return json({ error: msg }, 500);
  }
});
