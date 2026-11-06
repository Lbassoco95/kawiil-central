/**
 * Descarga la transcripción con hablantes de un bot de Recall, la guarda como VTT
 * (<v Nombre>) en el bucket mtg y encola la minuta. La usan el webhook de Recall
 * y mtg-recall-sync (traer a mano una grabación ya terminada).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MTG_BUCKET = "mtg";

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

export async function processTranscript(admin: ReturnType<typeof createClient>, meeting: Record<string, any>, botId: string) {
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


/** Estados del bot en los que ya salió de la llamada (la junta terminó). */
export const BOT_LEFT_STATUSES = new Set(["call_ended", "done"]);

/**
 * La llamada terminó: marca la junta como terminada si seguía programada o en curso.
 * No toca juntas que ya pasaron a minuta/cerradas/canceladas.
 */
export async function endMeetingFromBot(
  admin: ReturnType<typeof createClient>,
  meeting: { id: string; organization_id: string },
  botId: string,
): Promise<boolean> {
  const endedAt = new Date().toISOString();
  const { data } = await admin
    .from("mtg_meetings")
    .update({ status: "ended", ended_at: endedAt })
    .eq("id", meeting.id)
    .in("status", ["planned", "in_progress"])
    .select("id");
  if (!data || data.length === 0) return false;
  await admin.from("mtg_audit_log").insert({
    organization_id: meeting.organization_id,
    actor_user_id: null,
    entity_type: "meeting",
    entity_id: meeting.id,
    action: "meeting_ended",
    details: { ended_at: endedAt, origin: "recall", bot_id: botId },
  });
  return true;
}
