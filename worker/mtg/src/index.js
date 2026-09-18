/**
 * Worker Múuch' (Node) — reclama jobs de job_queue.
 * Corre en VM o local. Habla a openclaw-gateway, nunca a Anthropic directo.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENCLAW_GATEWAY_URL,
 * OPENCLAW_GATEWAY_TOKEN, MTG_GATEWAY_MOCK, MTG_GRAPH_MOCK
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const WORKER_ID = process.env.WORKER_ID || `mtg-worker-${process.pid}`;
const MOCK_GW = process.env.MTG_GATEWAY_MOCK === "1";
const MOCK_GRAPH = process.env.MTG_GRAPH_MOCK === "1";

const MOCK_VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hola, revisamos el avance del entregable.

00:12:04.000 --> 00:12:10.000
Acordamos enviar el borrador antes del viernes.

00:18:40.000 --> 00:18:48.000
El cliente confirma la fecha de entrega de evidencias.
`;

async function claim() {
  const { data, error } = await sb.rpc("claim_jobs", {
    p_kinds: ["mtg.fetch_transcript", "mtg.generate_minutes", "mtg.remind"],
    p_limit: 3,
    p_worker_id: WORKER_ID,
    p_lease_seconds: 600,
  });
  if (error) throw error;
  return data ?? [];
}

async function handleFetchTranscript(job) {
  const meetingId = job.payload?.meeting_id;
  if (!meetingId) throw new Error("meeting_id required");

  if (MOCK_GRAPH) {
    const path = `${job.organization_id}/mtg/client/mock/2026/09/transcripts/${Date.now()}_mock.vtt`;
    await sb.storage.from("mtg").upload(path, new Blob([MOCK_VTT], { type: "text/vtt" }), {
      upsert: true,
    });
    await sb
      .from("mtg_meetings")
      .update({ transcript_status: "received", transcript_path: path })
      .eq("id", meetingId);
    await sb.from("job_queue").insert({
      organization_id: job.organization_id,
      kind: "mtg.generate_minutes",
      payload: { meeting_id: meetingId },
      status: "pending",
    });
    await sb.rpc("complete_job", { p_job_id: job.id, p_result: { path, mock: true } });
    return;
  }
  throw new Error("Graph real no configurado — usar MTG_GRAPH_MOCK=1");
}

async function handleGenerateMinutes(job) {
  const meetingId = job.payload?.meeting_id;
  if (!meetingId) throw new Error("meeting_id required");

  const { data: meeting } = await sb.from("mtg_meetings").select("*").eq("id", meetingId).single();
  const { data: series } = meeting?.series_id
    ? await sb.from("mtg_series").select("*").eq("id", meeting.series_id).single()
    : { data: null };
  const { data: agreements } = await sb
    .from("mtg_agreements")
    .select("*")
    .eq("meeting_id", meetingId);
  const { data: decisions } = await sb.from("mtg_decisions").select("*").eq("meeting_id", meetingId);

  // Import dinámico del builder (duplicado mínimo para el worker standalone)
  const model = MOCK_GW
    ? {
        summary_by_topic: [],
        decisions: [],
        proposed_agreements: [
          {
            text: "Enviar borrador de respuesta antes del viernes",
            entity_key: null,
            owner_side: "kawiil",
            owner_hint: null,
            due_hint: null,
            project_hint: null,
            project_reason: null,
            transcript_ref: "00:12:04",
            confidence: 0.8,
          },
          {
            text: "Cliente confirma fecha de evidencias",
            entity_key: null,
            owner_side: "client",
            owner_hint: null,
            due_hint: null,
            project_hint: null,
            project_reason: null,
            transcript_ref: "00:18:40",
            confidence: 0.75,
          },
        ],
        project_hints_for_amber: [],
        open_questions: [],
        next_meeting_topics: ["Seguimiento de evidencias"],
      }
    : null;

  if (!MOCK_GW) {
    const gw = process.env.OPENCLAW_GATEWAY_URL || "http://host.docker.internal:3000";
    const token = process.env.OPENCLAW_GATEWAY_TOKEN;
    const res = await fetch(`${gw}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        model: "default",
        messages: [
          { role: "system", content: "minutes-v1 JSON only" },
          { role: "user", content: JSON.stringify({ meetingId }) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
  }

  const live = (agreements ?? []).filter((a) => a.origin === "captured_live");
  const md = [
    `# Minuta — ${series?.title ?? "Junta"}`,
    "",
    `**Fecha:** ${meeting.scheduled_at}`,
    "",
    "## Acuerdos en vivo",
    ...live.map((a) => `- ${a.text}`),
    "",
    "## Decisiones",
    ...(decisions ?? []).map((d) => `- ${d.text}`),
    "",
    "## Propuestos (modelo)",
    ...(model?.proposed_agreements ?? []).map((p) => `- ${p.text} (${p.transcript_ref})`),
  ].join("\n");

  // supersede drafts
  await sb
    .from("mtg_minutes")
    .update({ status: "superseded" })
    .eq("meeting_id", meetingId)
    .eq("status", "draft");

  const { data: versions } = await sb
    .from("mtg_minutes")
    .select("version")
    .eq("meeting_id", meetingId)
    .order("version", { ascending: false })
    .limit(1);
  const nextV = (versions?.[0]?.version ?? 0) + 1;

  const { data: minutes, error } = await sb
    .from("mtg_minutes")
    .insert({
      organization_id: job.organization_id,
      meeting_id: meetingId,
      version: nextV,
      status: "draft",
      content_md: md,
      generated_by: model ? "model" : "human",
      prompt_version: "minutes-v1",
      model_version: MOCK_GW ? "mock" : "gateway",
    })
    .select("id")
    .single();
  if (error) throw error;

  for (const p of model?.proposed_agreements ?? []) {
    const clientId =
      meeting.client_id ||
      series?.entities?.[0]?.client_id ||
      null;
    if (!clientId) continue;
    await sb.from("mtg_agreements").insert({
      organization_id: job.organization_id,
      meeting_id: meetingId,
      client_id: clientId,
      entity_key: p.entity_key,
      text: p.text,
      origin: "proposed_by_model",
      status: "proposed",
      owner_side: p.owner_side,
      owner_name: p.owner_hint,
      due_date: p.due_hint,
      transcript_ref: p.transcript_ref,
      confidence: p.confidence,
      project_hint: p.project_hint,
      project_reason: p.project_reason,
    });
  }

  await sb.from("mtg_meetings").update({ status: "minutes_draft", minutes_id: minutes.id }).eq("id", meetingId);
  await sb.rpc("complete_job", { p_job_id: job.id, p_result: { minutes_id: minutes.id } });
}

async function handleRemind(job) {
  const meetingId = job.payload?.meeting_id;
  const remindKind = job.payload?.remind_kind || "t1d";
  if (!meetingId) throw new Error("meeting_id required");

  const { data: meeting } = await sb.from("mtg_meetings").select("*").eq("id", meetingId).single();
  if (!meeting || meeting.status === "cancelled" || meeting.status === "closed") {
    await sb.rpc("complete_job", { p_job_id: job.id, p_result: { skipped: true, reason: "inactive" } });
    return;
  }

  const title = job.payload?.title || "Junta";
  const when = remindKind === "t1d" ? "mañana" : "en una hora";
  const link = `/juntas/${meetingId}`;
  const notifTitle = `Recordatorio de junta (${when})`;
  const notifBody = `${title} — abre ${link}`;

  const recipients = new Set();
  if (job.payload?.owner_user_id) recipients.add(job.payload.owner_user_id);
  for (const u of job.payload?.attendees_internal || []) {
    if (u) recipients.add(u);
  }
  // Si el payload no trae destinatarios, intenta desde la serie
  if (recipients.size === 0 && meeting.series_id) {
    const { data: series } = await sb.from("mtg_series").select("owner_user_id, attendees_internal").eq("id", meeting.series_id).single();
    if (series?.owner_user_id) recipients.add(series.owner_user_id);
    for (const u of series?.attendees_internal || []) if (u) recipients.add(u);
  }

  const rows = [...recipients].map((userId) => ({
    organization_id: job.organization_id,
    user_id: userId,
    type: "mtg_remind",
    title: notifTitle,
    body: notifBody,
    entity_type: "mtg_meeting",
    entity_id: meetingId,
    entity_ref: link,
  }));

  if (rows.length > 0) {
    await sb.from("notifications").insert(rows);
  }

  // Web push vía Edge (mismo patrón que otras notificaciones); best-effort.
  try {
    const fnUrl = `${url}/functions/v1/push-subscribe`;
    // El worker no envía push directo; deja entity_ref para el cliente.
    // Correo Graph modo aplicación: stub — requiere secretos en VM ([ALTO Polo]).
    if (!MOCK_GRAPH && process.env.MTG_GRAPH_SEND_REMIND === "1") {
      console.log(`[remind] Graph mail pending for ${meetingId} (${remindKind})`);
    }
  } catch (e) {
    console.warn("[remind] push/mail", e);
  }

  await sb.rpc("complete_job", {
    p_job_id: job.id,
    p_result: { notified: rows.length, remind_kind: remindKind },
  });
}

async function loop() {
  console.log(`[${WORKER_ID}] starting mock_gw=${MOCK_GW} mock_graph=${MOCK_GRAPH}`);
  for (;;) {
    try {
      const jobs = await claim();
      for (const job of jobs) {
        try {
          if (job.kind === "mtg.fetch_transcript") await handleFetchTranscript(job);
          else if (job.kind === "mtg.generate_minutes") await handleGenerateMinutes(job);
          else if (job.kind === "mtg.remind") await handleRemind(job);
          else await sb.rpc("fail_job", { p_job_id: job.id, p_error: `unknown kind ${job.kind}` });
        } catch (e) {
          console.error(job.id, e);
          await sb.rpc("fail_job", { p_job_id: job.id, p_error: String(e) });
        }
      }
    } catch (e) {
      console.error("claim loop", e);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

loop();
