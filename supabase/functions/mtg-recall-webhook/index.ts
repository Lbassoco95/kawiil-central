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

const MTG_BUCKET = "mtg";
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

type RecallWord = { text: string; start_timestamp?: { relative?: number }; end_timestamp?: { relative?: number } | null };
type RecallEntry = {
  participant?: { id?: number | string; name?: string | null; is_host?: boolean; email?: string | null };
  words?: RecallWord[];
};
type Participant = { id?: number | string; name?: string | null; is_host?: boolean; email?: string | null };

function vttTs(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000) % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(sec)}.${p(ms, 3)}`;
}

/** VTT con voice tags (<v Nombre>). Parte intervenciones largas en cues de ≤ ~30 palabras. */
function transcriptToVtt(entries: RecallEntry[]): { vtt: string; cues: number; speakers: string[] } {
  const lines = ["WEBVTT", ""];
  const speakers = new Set<string>();
  let n = 0;
  const flat = entries
    .map((e) => ({ e, words: (e.words ?? []).filter((w) => (w.text ?? "").trim()) }))
    .filter((x) => x.words.length > 0)
    .sort((a, b) => (a.words[0].start_timestamp?.relative ?? 0) - (b.words[0].start_timestamp?.relative ?? 0));

  for (const { e, words } of flat) {
    const name = (e.participant?.name || "").trim() || `Participante ${e.participant?.id ?? "?"}`;
    speakers.add(name);
    const safeName = name.replace(/[<>&]/g, "");
    for (let i = 0; i < words.length; i += 30) {
      const part = words.slice(i, i + 30);
      const start = part[0].start_timestamp?.relative ?? 0;
      const last = part[part.length - 1];
      const end = last.end_timestamp?.relative ?? last.start_timestamp?.relative ?? start;
      const text = part.map((w) => w.text.trim()).join(" ").replace(/[<>&]/g, "");
      lines.push(String(++n), `${vttTs(start)} --> ${vttTs(Math.max(end, start + 0.5))}`, `<v ${safeName}>${text}`, "");
    }
  }
  return { vtt: lines.join("\n"), cues: n, speakers: [...speakers] };
}

async function recallGet(url: string, key: string, auth = true): Promise<Response> {
  return await fetch(url, { headers: auth ? { Authorization: `Token ${key}` } : {} });
}

async function processTranscript(admin: ReturnType<typeof createClient>, meeting: Record<string, any>, botId: string) {
  const key = Deno.env.get("RECALL_API_KEY");
  if (!key) throw new Error("RECALL_API_KEY no configurada");
  const host = Deno.env.get("RECALL_REGION_HOST") || "us-west-2.recall.ai";

  const botResp = await recallGet(`https://${host}/api/v1/bot/${botId}/`, key);
  if (!botResp.ok) throw new Error(`Recall retrieve bot ${botResp.status}`);
  const bot = await botResp.json();
  const shortcuts = (bot.recordings ?? []).map((r: any) => r?.media_shortcuts ?? {});
  const tUrl = shortcuts.map((s: any) => s?.transcript?.data?.download_url).find(Boolean);
  const pUrl = shortcuts.map((s: any) => s?.participant_events?.data?.participants_download_url).find(Boolean);
  if (!tUrl) throw new Error("El bot no tiene transcripción descargable");

  // Las URLs de descarga son prefirmadas: no llevan Authorization.
  const tResp = await recallGet(tUrl, key, false);
  if (!tResp.ok) throw new Error(`Descarga de transcripción ${tResp.status}`);
  const entries = (await tResp.json()) as RecallEntry[];

  let participants: Participant[] = [];
  if (pUrl) {
    const pResp = await recallGet(pUrl, key, false);
    if (pResp.ok) participants = (await pResp.json()) as Participant[];
  }
  // Sin lista de participantes: usar los que hablaron.
  const byId = new Map<string, Participant>();
  for (const p of participants) byId.set(String(p.id), p);
  for (const e of entries) {
    if (e.participant && !byId.has(String(e.participant.id))) byId.set(String(e.participant.id), e.participant);
  }
  const roster = [...byId.values()]
    .filter((p) => (p.name ?? "").trim())
    .map((p) => ({ id: p.id, name: p.name, is_host: !!p.is_host, email: p.email ?? null }));

  const { vtt, cues, speakers } = transcriptToVtt(entries);
  if (cues === 0) throw new Error("La transcripción de Recall no trae habla");

  let anchorType = "client";
  let anchorId: string = meeting.client_id ?? meeting.organization_id;
  if (meeting.series_id) {
    const { data: s } = await admin.from("mtg_series").select("anchor_type, anchor_id").eq("id", meeting.series_id).maybeSingle();
    if (s) {
      anchorType = s.anchor_type;
      anchorId = s.anchor_id;
    }
  }
  const now = new Date();
  const path = `${meeting.organization_id}/mtg/${anchorType}/${anchorId}/${now.getUTCFullYear()}/${String(
    now.getUTCMonth() + 1,
  ).padStart(2, "0")}/transcripts/${now.toISOString().replace(/[:.]/g, "-")}_transcript-recall.vtt`;

  const { error: upErr } = await admin.storage
    .from(MTG_BUCKET)
    .upload(path, new Blob([vtt], { type: "text/vtt" }), { upsert: true, contentType: "text/vtt" });
  if (upErr) throw new Error(`upload transcript: ${upErr.message}`);

  await admin
    .from("mtg_meetings")
    .update({
      transcript_status: "received",
      transcript_path: path,
      transcript_unavailable_reason: null,
      recall_participants: roster,
    })
    .eq("id", meeting.id);

  await admin.from("mtg_audit_log").insert({
    organization_id: meeting.organization_id,
    actor_user_id: null,
    entity_type: "transcript",
    entity_id: meeting.id,
    action: "transcript_received",
    details: { origin: "recall", bot_id: botId, path, cues, speakers, participants: roster.length },
  });

  await admin.from("job_queue").insert({
    organization_id: meeting.organization_id,
    kind: "mtg.generate_minutes",
    payload: {
      meeting_id: meeting.id,
      origin: "recall",
      speaker_attribution: true,
      participants: roster.map((p) => p.name),
      speakers,
    },
    status: "pending",
  });

  // Resumen con IA con la transcripción atribuida (en segundo plano: el webhook responde ya).
  const summarize = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mtg-summarize-meeting`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ meeting_id: meeting.id, language: "es" }),
  })
    .then(async (r) => {
      if (!r.ok) console.error("mtg-summarize-meeting", r.status, (await r.text()).slice(0, 300));
    })
    .catch((e) => console.error("mtg-summarize-meeting", e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(summarize);
  else await summarize;
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
