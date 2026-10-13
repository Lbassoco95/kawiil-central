/**
 * Resumen de una junta a partir de su transcripción (OpenAI).
 * JWT requerido. Secret: OPENAI_API_KEY.
 *
 * Genera: resumen ejecutivo, puntos importantes, compromisos (responsable y fecha),
 * notas relevantes, temas pendientes y estimado de participantes. Siempre en el
 * idioma elegido (es por defecto) aunque la junta mezcle idiomas (p. ej. español y chino).
 * Guarda un borrador en mtg_minutes (reemplaza borradores previos).
 *
 * Nota: Whisper no identifica voces; el nº de participantes es un ESTIMADO por el contenido.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Lang = "es" | "en" | "zh";
const LANG_NAME: Record<Lang, string> = { es: "español de México", en: "English", zh: "中文简体" };
const H: Record<Lang, Record<string, string>> = {
  es: {
    title: "Resumen de junta", date: "Fecha", summary: "Resumen ejecutivo", key: "Puntos más importantes",
    commitments: "Compromisos y fechas", notes: "Notas relevantes", pending: "Temas pendientes",
    people: "Participantes", est: "estimado", langs: "Idiomas en la junta", who: "Responsable", when: "Fecha",
    none: "(ninguno)", ref: "ref.", warn: "Estimado por el contenido de la conversación; la transcripción no identifica voces.",
  },
  en: {
    title: "Meeting summary", date: "Date", summary: "Executive summary", key: "Key points",
    commitments: "Commitments and dates", notes: "Relevant notes", pending: "Open topics",
    people: "Participants", est: "estimated", langs: "Languages spoken", who: "Owner", when: "Date",
    none: "(none)", ref: "ref.", warn: "Estimated from the conversation content; the transcript does not identify voices.",
  },
  zh: {
    title: "会议纪要", date: "日期", summary: "执行摘要", key: "重点",
    commitments: "承诺与日期", notes: "相关备注", pending: "待办事项",
    people: "参会人员", est: "估计", langs: "会议语言", who: "负责人", when: "日期",
    none: "（无）", ref: "参考", warn: "根据对话内容估计；转写不识别声音。",
  },
};

type Summary = {
  resumen_ejecutivo?: string;
  puntos_importantes?: string[];
  compromisos?: { texto?: string; responsable?: string | null; fecha?: string | null; referencia?: string | null }[];
  notas_relevantes?: string[];
  temas_pendientes?: string[];
  participantes?: { estimado?: number | null; confianza?: string; nombres_mencionados?: string[]; nota?: string };
  idiomas?: { principal?: string; secundario?: string | null };
};

function ts(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function chat(apiKey: string, model: string, system: string, user: string, jsonMode: boolean): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const c = d?.choices?.[0]?.message?.content;
  if (!c || typeof c !== "string") throw new Error("OpenAI: respuesta vacía");
  return c;
}

function buildMd(lang: Lang, title: string, dateLabel: string, s: Summary): string {
  const h = H[lang];
  const L: string[] = [`# ${h.title} — ${title}`, "", `**${h.date}:** ${dateLabel}`, ""];
  L.push(`## ${h.summary}`, s.resumen_ejecutivo?.trim() || h.none, "");
  const list = (name: string, items?: string[]) => {
    L.push(`## ${name}`);
    if (items && items.length) for (const i of items) L.push(`- ${i}`);
    else L.push(`- ${h.none}`);
    L.push("");
  };
  list(h.key, s.puntos_importantes);
  L.push(`## ${h.commitments}`);
  if (s.compromisos && s.compromisos.length) {
    for (const c of s.compromisos) {
      const parts = [
        c.responsable ? `${h.who}: ${c.responsable}` : null,
        c.fecha ? `${h.when}: ${c.fecha}` : null,
        c.referencia ? `${h.ref} ${c.referencia}` : null,
      ].filter(Boolean);
      L.push(`- ${c.texto ?? ""}${parts.length ? ` _(${parts.join(" · ")})_` : ""}`);
    }
  } else L.push(`- ${h.none}`);
  L.push("");
  list(h.notes, s.notas_relevantes);
  list(h.pending, s.temas_pendientes);
  const p = s.participantes;
  L.push(`## ${h.people}`);
  L.push(`- ${p?.estimado != null ? `${p.estimado} (${h.est}${p.confianza ? `, ${p.confianza}` : ""})` : "—"}`);
  if (p?.nombres_mencionados?.length) L.push(`- ${p.nombres_mencionados.join(", ")}`);
  L.push(`- _${p?.nota?.trim() || h.warn}_`, "");
  if (s.idiomas?.principal) {
    L.push(`**${h.langs}:** ${s.idiomas.principal}${s.idiomas.secundario ? ` + ${s.idiomas.secundario}` : ""}`);
  }
  return L.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY no configurada", code: "openai_not_configured" }, 503);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud.user) return json({ error: "unauthorized" }, 401);
    const userId = ud.user.id;

    const body = await req.json().catch(() => ({}));
    const meetingId = String(body?.meeting_id || "").trim();
    if (!meetingId) return json({ error: "meeting_id requerido" }, 400);
    const l = String(body?.language ?? "es").toLowerCase();
    const lang: Lang = l === "en" || l === "zh" ? l : "es";

    const { data: profile } = await admin.from("profiles").select("organization_id").eq("user_id", userId).single();
    const { data: meeting } = await admin
      .from("mtg_meetings")
      .select("id, organization_id, series_id, title, scheduled_at")
      .eq("id", meetingId)
      .single();
    if (!meeting) return json({ error: "junta no encontrada" }, 404);
    if (!profile?.organization_id || meeting.organization_id !== profile.organization_id) return json({ error: "forbidden" }, 403);

    // Texto con marcas de tiempo corridas a lo largo de todas las tomas.
    const { data: takes } = await admin
      .from("mtg_meeting_recordings")
      .select("transcript_segments, duration_sec")
      .eq("meeting_id", meetingId)
      .order("saved_at", { ascending: true });
    const lines: string[] = [];
    let offset = 0;
    for (const t of takes ?? []) {
      const segs = (t.transcript_segments ?? []) as { start: number; text: string }[];
      for (const s of segs) if (s.text?.trim()) lines.push(`[${ts(Number(s.start) + offset)}] ${s.text.trim()}`);
      offset += Number(t.duration_sec) || (segs.length ? Number(segs[segs.length - 1].start) : 0);
    }
    if (lines.length === 0) return json({ error: "La junta no tiene transcripción. Transcribe las grabaciones primero." }, 400);
    const full = lines.join("\n");

    let series: { title?: string } | null = null;
    if (meeting.series_id) {
      const { data: s } = await admin.from("mtg_series").select("title").eq("id", meeting.series_id).maybeSingle();
      series = s;
    }
    const title = series?.title ?? meeting.title ?? "Junta";
    const dateLabel = String(meeting.scheduled_at).slice(0, 10);

    const system =
      `Eres el asistente de minutas de Kawiil. Recibes la transcripción de una junta de trabajo ` +
      `(puede mezclar español y chino; ya puede venir traducida). Responde SIEMPRE en ${LANG_NAME[lang]}, ` +
      `aunque partes estén en otro idioma. No inventes: si algo no está claro, omítelo o indícalo. ` +
      `Devuelve SOLO JSON con: resumen_ejecutivo (string, 5-8 líneas), puntos_importantes (string[]), ` +
      `compromisos ([{texto, responsable|null, fecha|null, referencia|null}]; fecha = la fecha o plazo dicho ` +
      `(ISO YYYY-MM-DD si se puede deducir de la fecha de la junta, si no la frase original); referencia = marca de tiempo [hh:mm:ss]), ` +
      `notas_relevantes (string[]), temas_pendientes (string[]), ` +
      `participantes ({estimado: número|null de personas distintas que hablan, confianza: "alta"|"media"|"baja", nombres_mencionados: string[], nota: string}), ` +
      `idiomas ({principal, secundario|null}). ` +
      `El número de participantes es un ESTIMADO por turnos y contenido; la transcripción no identifica voces.`;

    let material = full;
    // Junta muy larga: notas por bloques y luego síntesis.
    if (full.length > 80_000) {
      const chunks: string[] = [];
      for (let i = 0; i < full.length; i += 60_000) chunks.push(full.slice(i, i + 60_000));
      const notes = await Promise.all(
        chunks.map((c, i) =>
          chat(apiKey, "gpt-4o-mini",
            `Extrae notas detalladas (en ${LANG_NAME[lang]}) de este bloque ${i + 1}/${chunks.length} de una junta: temas, decisiones, compromisos con responsable y fecha, cifras, nombres. Conserva marcas de tiempo.`,
            c, false),
        ),
      );
      material = notes.map((n, i) => `# Bloque ${i + 1}\n${n}`).join("\n\n");
    }

    const raw = await chat(apiKey, "gpt-4o", system, `Junta: ${title}\nFecha: ${dateLabel}\n\nTranscripción:\n${material}`, true);
    let summary: Summary;
    try {
      summary = JSON.parse(raw);
    } catch {
      throw new Error("OpenAI devolvió un JSON inválido");
    }
    const md = buildMd(lang, title, dateLabel, summary);

    // Un borrador nuevo reemplaza a los anteriores.
    await admin.from("mtg_minutes").update({ status: "superseded" }).eq("meeting_id", meetingId).eq("status", "draft");
    const { data: last } = await admin.from("mtg_minutes").select("version").eq("meeting_id", meetingId).order("version", { ascending: false }).limit(1);
    const { data: minutes, error: insErr } = await admin
      .from("mtg_minutes")
      .insert({
        organization_id: meeting.organization_id,
        meeting_id: meetingId,
        version: (last?.[0]?.version ?? 0) + 1,
        status: "draft",
        content_md: md,
        generated_by: "model",
        model_version: "openai:gpt-4o",
        prompt_version: "summary-v1",
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`guardar minuta: ${insErr.message}`);

    // El worker externo solo arma una plantilla; que no pise este resumen.
    await admin
      .from("job_queue")
      .update({ status: "dead", last_error: "superseded_by_openai_summary", completed_at: new Date().toISOString() })
      .eq("kind", "mtg.generate_minutes")
      .eq("status", "pending")
      .contains("payload", { meeting_id: meetingId });

    return json({ minutes_id: minutes.id, content_md: md, summary, language: lang, transcript_chars: full.length });
  } catch (e) {
    console.error("mtg-summarize-meeting", e);
    return json({ error: e instanceof Error ? e.message : "error desconocido" }, 500);
  }
});
