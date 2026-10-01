/**
 * Transcribe la grabación de una junta (audio/video) con OpenAI Whisper
 * y deja el texto en español en el bucket mtg (transcripts).
 *
 * JWT requerido. Secret: OPENAI_API_KEY.
 * Soporta grabaciones largas (~3 h): parte el archivo en trozos ≤20 MB
 * (límite Whisper ~25 MB) y fusiona segmentos con offset temporal.
 * Multiidioma → español.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MTG_BUCKET = "mtg";
/** Tope por petición Whisper. */
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
/** Tamaño de cada trozo (bajo el techo). */
const WHISPER_CHUNK_BYTES = 20 * 1024 * 1024;
/** Archivo completo admitido (~3 h audio con margen). */
const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

type WhisperSegment = { start: number; end: number; text: string };

function formatVttTimestamp(seconds: number): string {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const whole = Math.floor(sec);
  const ms = Math.round((sec - whole) * 1000);
  return (
    `${String(h).padStart(2, "0")}:` +
    `${String(m).padStart(2, "0")}:` +
    `${String(whole).padStart(2, "0")}.` +
    `${String(ms).padStart(3, "0")}`
  );
}

function segmentsToVtt(segments: WhisperSegment[]): string {
  const lines = ["WEBVTT", ""];
  let i = 1;
  for (const seg of segments) {
    const text = (seg.text || "").trim();
    if (!text) continue;
    lines.push(String(i++));
    lines.push(
      `${formatVttTimestamp(seg.start)} --> ${formatVttTimestamp(seg.end)}`,
    );
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n");
}

function isSpanish(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.trim().toLowerCase();
  return c === "es" || c === "spa" || c.startsWith("es-") || c.startsWith("spa");
}

function buildStoragePath(opts: {
  organizationId: string;
  anchorType: string;
  anchorId: string;
  fileName: string;
}): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const safe = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${opts.organizationId}/mtg/${opts.anchorType}/${opts.anchorId}/${yyyy}/${mm}/transcripts/${ts}_${safe}`;
}

/** Parte bytes para Whisper; reusa cabecera en trozos siguientes (webm/mp4). */
function splitBytesForWhisper(
  bytes: Uint8Array,
  chunkBytes = WHISPER_CHUNK_BYTES,
  headerBytes = 64 * 1024,
): Uint8Array[] {
  if (bytes.byteLength === 0) return [];
  if (bytes.byteLength <= chunkBytes) return [bytes];
  const headerLen = Math.min(headerBytes, Math.floor(chunkBytes / 4), bytes.byteLength);
  const header = bytes.subarray(0, headerLen);
  const out: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset === 0) {
      const end = Math.min(chunkBytes, bytes.byteLength);
      out.push(bytes.subarray(0, end));
      offset = end;
      continue;
    }
    const bodyBudget = chunkBytes - headerLen;
    const end = Math.min(offset + bodyBudget, bytes.byteLength);
    const body = bytes.subarray(offset, end);
    const merged = new Uint8Array(headerLen + body.byteLength);
    merged.set(header, 0);
    merged.set(body, headerLen);
    out.push(merged);
    offset = end;
  }
  return out;
}

async function whisperTranscribeChunk(opts: {
  apiKey: string;
  bytes: Uint8Array;
  mime: string;
  ext: string;
  fileName: string;
}): Promise<{ segments: WhisperSegment[]; duration: number; language: string | null }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([opts.bytes], { type: opts.mime }),
    opts.fileName,
  );
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append(
    "prompt",
    "Junta de trabajo Kawiil. Puede haber español, inglés o chino. Nombres propios y términos fiscales/legales.",
  );

  const sttResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
  });
  if (!sttResp.ok) {
    const errText = await sttResp.text();
    throw new Error(`Whisper ${sttResp.status}: ${errText.slice(0, 400)}`);
  }
  const stt = await sttResp.json();
  const language =
    typeof stt.language === "string" ? stt.language : null;
  let segments: WhisperSegment[] = Array.isArray(stt.segments)
    ? stt.segments.map((s: { start?: number; end?: number; text?: string }) => ({
        start: Number(s.start) || 0,
        end: Number(s.end) || 0,
        text: String(s.text || ""),
      }))
    : [];
  if (segments.length === 0 && typeof stt.text === "string" && stt.text.trim()) {
    segments = [{ start: 0, end: 1, text: stt.text.trim() }];
  }
  const duration =
    typeof stt.duration === "number" && stt.duration > 0
      ? stt.duration
      : segments.reduce((max, s) => Math.max(max, s.end), 0);
  return { segments, duration, language };
}

async function translateSegmentBatch(
  apiKey: string,
  batch: { i: number; t: string }[],
  sourceLang: string | null,
): Promise<Map<number, string>> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Traduce al español de México textos de una junta de trabajo. " +
            "Devuelve JSON {\"items\":[{\"i\":number,\"t\":string}]} con el mismo índice i. " +
            "Conserva nombres propios, marcas y términos técnicos cuando no tengan traducción natural. " +
            "No agregues comentarios.",
        },
        {
          role: "user",
          content: JSON.stringify({
            source_language: sourceLang || "unknown",
            items: batch,
          }),
        },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI translate failed: ${resp.status} ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI translate: respuesta vacía");
  }
  let parsed: { items?: { i: number; t: string }[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI translate: JSON inválido");
  }
  const byIndex = new Map<number, string>();
  for (const item of parsed.items ?? []) {
    if (typeof item?.i === "number" && typeof item?.t === "string") {
      byIndex.set(item.i, item.t.trim());
    }
  }
  return byIndex;
}

async function translateSegmentsToSpanish(
  apiKey: string,
  segments: WhisperSegment[],
  sourceLang: string | null,
): Promise<WhisperSegment[]> {
  if (segments.length === 0) return segments;
  const byIndex = new Map<number, string>();
  const batchSize = 80;
  for (let start = 0; start < segments.length; start += batchSize) {
    const slice = segments.slice(start, start + batchSize);
    const payload = slice.map((s, j) => ({
      i: start + j,
      t: s.text,
    }));
    const part = await translateSegmentBatch(apiKey, payload, sourceLang);
    for (const [k, v] of part) byIndex.set(k, v);
  }
  return segments.map((s, idx) => ({
    ...s,
    text: byIndex.get(idx) || s.text,
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({
          error:
            "OPENAI_API_KEY no configurada en Edge Functions secrets. Sin ella no se puede transcribir.",
          code: "openai_not_configured",
        }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const meetingId = String(body?.meeting_id || "").trim();
    if (!meetingId) {
      return new Response(JSON.stringify({ error: "meeting_id requerido" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .single();
    if (pErr || !profile?.organization_id) {
      return new Response(JSON.stringify({ error: "sin organización" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: meeting, error: mErr } = await admin
      .from("mtg_meetings")
      .select("id, organization_id, client_id, series_id, recording_path, transcript_status, status")
      .eq("id", meetingId)
      .single();
    if (mErr || !meeting) {
      return new Response(JSON.stringify({ error: "junta no encontrada" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (meeting.organization_id !== profile.organization_id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!meeting.recording_path) {
      return new Response(
        JSON.stringify({ error: "Esta junta no tiene grabación. Graba o sube audio/video primero." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    await admin
      .from("mtg_meetings")
      .update({ transcript_status: "subscribed", transcript_unavailable_reason: null })
      .eq("id", meetingId);

    const { data: fileBlob, error: dlErr } = await admin.storage
      .from(MTG_BUCKET)
      .download(meeting.recording_path);
    if (dlErr || !fileBlob) {
      await admin
        .from("mtg_meetings")
        .update({
          transcript_status: "failed",
          transcript_unavailable_reason: "No se pudo descargar la grabación del bucket",
        })
        .eq("id", meetingId);
      return new Response(
        JSON.stringify({ error: "No se pudo descargar la grabación", details: dlErr?.message }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    if (bytes.byteLength > MAX_RECORDING_BYTES) {
      await admin
        .from("mtg_meetings")
        .update({
          transcript_status: "failed",
          transcript_unavailable_reason:
            "Grabación > 200 MB (~3 h). Sube audio más liviano o parte la conversación.",
        })
        .eq("id", meetingId);
      return new Response(
        JSON.stringify({
          error:
            "La grabación supera ~200 MB (tope para ~3 horas). Usa audio a bitrate moderado o parte la sesión.",
          code: "file_too_large",
          size_bytes: bytes.byteLength,
        }),
        { status: 413, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const pathLower = String(meeting.recording_path).toLowerCase();
    const ext = pathLower.includes(".mp4")
      ? "mp4"
      : pathLower.includes(".mp3")
        ? "mp3"
        : pathLower.includes(".m4a")
          ? "m4a"
          : pathLower.includes(".wav")
            ? "wav"
            : pathLower.includes(".ogg")
              ? "ogg"
              : "webm";
    const mime =
      ext === "mp3"
        ? "audio/mpeg"
        : ext === "mp4"
          ? "video/mp4"
          : ext === "wav"
            ? "audio/wav"
            : ext === "m4a"
              ? "audio/mp4"
              : "audio/webm";

    const chunks = splitBytesForWhisper(bytes);
    let segments: WhisperSegment[] = [];
    let languageDetected: string | null = null;
    let timeOffset = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.byteLength > WHISPER_MAX_BYTES) {
          throw new Error(`Trozo ${i + 1} supera el límite Whisper (${chunk.byteLength} bytes)`);
        }
        const part = await whisperTranscribeChunk({
          apiKey: openaiKey,
          bytes: chunk,
          mime,
          ext,
          fileName: `recording-part${i + 1}.${ext}`,
        });
        if (!languageDetected && part.language) languageDetected = part.language;
        for (const s of part.segments) {
          segments.push({
            start: s.start + timeOffset,
            end: s.end + timeOffset,
            text: s.text,
          });
        }
        timeOffset += part.duration > 0
          ? part.duration
          : Math.max(0, ...part.segments.map((s) => s.end), 0);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from("mtg_meetings")
        .update({
          transcript_status: "failed",
          transcript_unavailable_reason: msg.slice(0, 240),
        })
        .eq("id", meetingId);
      return new Response(
        JSON.stringify({
          error: "OpenAI Whisper falló al transcribir (posible archivo largo)",
          details: msg.slice(0, 400),
          chunks: chunks.length,
        }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (segments.length === 0) {
      await admin
        .from("mtg_meetings")
        .update({
          transcript_status: "failed",
          transcript_unavailable_reason: "Whisper no detectó habla en la grabación",
        })
        .eq("id", meetingId);
      return new Response(
        JSON.stringify({ error: "No se detectó habla en la grabación" }),
        { status: 422, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let translated = false;
    if (!isSpanish(languageDetected)) {
      segments = await translateSegmentsToSpanish(
        openaiKey,
        segments,
        languageDetected,
      );
      translated = true;
    }

    const vtt = segmentsToVtt(segments);
    let series: { anchor_type: string; anchor_id: string } | null = null;
    if (meeting.series_id) {
      const { data: s } = await admin
        .from("mtg_series")
        .select("anchor_type, anchor_id")
        .eq("id", meeting.series_id)
        .maybeSingle();
      series = s;
    }
    const anchorType = series?.anchor_type ?? "client";
    const anchorId =
      series?.anchor_id ?? meeting.client_id ?? meeting.organization_id;
    const transcriptPath = buildStoragePath({
      organizationId: meeting.organization_id,
      anchorType,
      anchorId,
      fileName: "transcript-openai.vtt",
    });

    const { error: upErr } = await admin.storage
      .from(MTG_BUCKET)
      .upload(transcriptPath, new Blob([vtt], { type: "text/vtt" }), {
        upsert: true,
        contentType: "text/vtt",
      });
    if (upErr) {
      throw new Error(`upload transcript: ${upErr.message}`);
    }

    await admin
      .from("mtg_meetings")
      .update({
        transcript_status: "received",
        transcript_path: transcriptPath,
        transcript_unavailable_reason: null,
      })
      .eq("id", meetingId);

    await admin.from("mtg_audit_log").insert({
      organization_id: meeting.organization_id,
      actor_user_id: userId,
      entity_type: "transcript",
      entity_id: meetingId,
      action: "transcript_received",
      details: {
        origin: "openai_whisper",
        path: transcriptPath,
        language_detected: languageDetected,
        translated_to_spanish: translated,
        segments: segments.length,
        chunks: chunks.length,
        size_bytes: bytes.byteLength,
      },
    });

    let enqueued = false;
    try {
      const { error: qErr } = await admin.from("job_queue").insert({
        organization_id: meeting.organization_id,
        kind: "mtg.generate_minutes",
        payload: {
          meeting_id: meetingId,
          origin: "openai_whisper",
          language_detected: languageDetected,
          translated_to_spanish: translated,
        },
        status: "pending",
      });
      enqueued = !qErr;
    } catch {
      enqueued = false;
    }

    return new Response(
      JSON.stringify({
        transcript_path: transcriptPath,
        language_detected: languageDetected,
        translated_to_spanish: translated,
        enqueued_minutes: enqueued,
        segments: segments.length,
        chunks: chunks.length,
        size_bytes: bytes.byteLength,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mtg-transcribe-recording", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "error desconocido",
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
