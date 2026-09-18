/**
 * Borrador de minuta sin modelo (capturado en vivo).
 * JWT requerido. No llama al gateway; el worker enriquecerá después.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function buildDraft(opts: {
  title: string;
  scheduledAt: string;
  attendees: string[];
  liveAgreements: { text: string; status: string }[];
  decided: { text: string; resolution: string | null }[];
  topicLines: string[];
  expectedNext: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Minuta — ${opts.title}`);
  lines.push("");
  lines.push(`**Fecha:** ${opts.scheduledAt}`);
  lines.push(`**Asistentes:** ${opts.attendees.join(", ") || "—"}`);
  lines.push("");
  lines.push("## Acuerdos capturados en vivo");
  if (opts.liveAgreements.length === 0) lines.push("- (ninguno)");
  else for (const a of opts.liveAgreements) lines.push(`- [${a.status}] ${a.text}`);
  lines.push("");
  lines.push("## Decisiones");
  if (opts.decided.length === 0) lines.push("- (ninguna)");
  else {
    for (const d of opts.decided) {
      lines.push(`- ${d.text}${d.resolution ? ` → ${d.resolution}` : ""}`);
    }
  }
  if (opts.topicLines.length > 0) {
    lines.push("", "## Temas revisados (tablero)");
    for (const t of opts.topicLines) lines.push(`- ${t}`);
  }
  lines.push("", "## Temas para la próxima");
  if (opts.expectedNext.length > 0) {
    for (const t of opts.expectedNext) lines.push(`- ${t}`);
  } else {
    lines.push("- (pendiente de enriquecer con el modelo)");
  }
  lines.push(
    "",
    "_Borrador sin modelo — el worker enriquecerá con la transcripción cuando esté disponible._",
  );
  return lines.join("\n");
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const actorId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const meetingId = body?.meeting_id as string | undefined;
    if (!meetingId) {
      return new Response(JSON.stringify({ error: "meeting_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: meeting, error: mErr } = await admin
      .from("mtg_meetings")
      .select("*")
      .eq("id", meetingId)
      .single();
    if (mErr || !meeting) {
      return new Response(JSON.stringify({ error: "meeting not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const allowed = ["ended", "minutes_draft", "in_progress", "planned"];
    if (!allowed.includes(meeting.status)) {
      return new Response(
        JSON.stringify({ error: `estado ${meeting.status} no admite borrador` }),
        { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    let series: { title?: string; attendees_internal?: string[]; attendees_client?: { name?: string }[] } | null =
      null;
    if (meeting.series_id) {
      const { data: s } = await admin.from("mtg_series").select("*").eq("id", meeting.series_id).single();
      series = s;
    }

    const { data: agreements } = await admin
      .from("mtg_agreements")
      .select("text, status, origin")
      .eq("meeting_id", meetingId);
    const live = (agreements ?? []).filter((a) => a.origin === "captured_live");

    const { data: decisions } = await admin
      .from("mtg_decisions")
      .select("text, resolution, status")
      .eq("meeting_id", meetingId);

    const { data: updates } = await admin
      .from("mtg_topic_updates")
      .select("movement, topic_id, progress_since_last, next_step")
      .eq("meeting_id", meetingId);
    const topicIds = [...new Set((updates ?? []).map((u) => u.topic_id).filter(Boolean))];
    let topicTitle = new Map<string, string>();
    if (topicIds.length > 0) {
      const { data: topics } = await admin.from("mtg_topics").select("id, title").in("id", topicIds);
      topicTitle = new Map((topics ?? []).map((t) => [t.id, t.title]));
    }
    const topicLines = (updates ?? []).map((u) => {
      const title = topicTitle.get(u.topic_id) ?? u.topic_id;
      return `${title} [${u.movement}]${u.progress_since_last ? ` — ${u.progress_since_last}` : ""}`;
    });

    const { data: expected } = await admin
      .from("mtg_expected_next")
      .select("text")
      .eq("meeting_id", meetingId)
      .order("sort_order");

    const attendees: string[] = [];
    for (const a of series?.attendees_client ?? []) {
      if (a?.name) attendees.push(a.name);
    }

    const md = buildDraft({
      title: series?.title ?? "Junta",
      scheduledAt: meeting.scheduled_at,
      attendees,
      liveAgreements: live.map((a) => ({ text: a.text, status: a.status })),
      decided: (decisions ?? []).map((d) => ({
        text: d.text,
        resolution: d.resolution ?? null,
      })),
      topicLines,
      expectedNext: (expected ?? []).map((e) => e.text).filter(Boolean),
    });

    await admin
      .from("mtg_minutes")
      .update({ status: "superseded" })
      .eq("meeting_id", meetingId)
      .eq("status", "draft");

    const { data: versions } = await admin
      .from("mtg_minutes")
      .select("version")
      .eq("meeting_id", meetingId)
      .order("version", { ascending: false })
      .limit(1);
    const nextV = ((versions?.[0]?.version as number) ?? 0) + 1;

    const { data: minutes, error: insErr } = await admin
      .from("mtg_minutes")
      .insert({
        organization_id: meeting.organization_id,
        meeting_id: meetingId,
        version: nextV,
        status: "draft",
        content_md: md,
        generated_by: "human",
        prompt_version: "live-only-v1",
        model_version: null,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    await admin
      .from("mtg_meetings")
      .update({ status: "minutes_draft", minutes_id: minutes.id })
      .eq("id", meetingId);

    await admin.from("mtg_audit_log").insert({
      organization_id: meeting.organization_id,
      actor_user_id: actorId,
      entity_type: "minutes",
      entity_id: minutes.id,
      action: "minutes_generated",
      details: { origin: "mtg-minutes-draft", without_model: true },
    });

    return new Response(
      JSON.stringify({ ok: true, minutes_id: minutes.id, version: nextV }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mtg-minutes-draft", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
