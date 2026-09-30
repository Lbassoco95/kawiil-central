/**
 * Importa capturas de una sesión (JSON fuera del repo) sobre updates/decisiones.
 * Idempotente: no duplica session_notes si el texto ya está.
 *
 * Uso:
 *   SEED_JSON=$HOME/Downloads/mtg-sesion-grupo-sylon-2026-09-17.json \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx tools/mtg/seed/load-sesion.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jsonPath =
  process.env.SEED_JSON ||
  resolve(process.env.HOME || "~", "Downloads/mtg-sesion-grupo-sylon-2026-09-17.json");

if (!url || !key) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!existsSync(jsonPath)) {
  console.error(`JSON no encontrado: ${jsonPath}`);
  process.exit(2);
}

const MOVEMENT_MAP: Record<string, string> = {
  resolved: "resolved",
  advanced: "advanced",
  "avanzó": "advanced",
  avanzo: "advanced",
  unchanged: "unchanged",
  sin_movimiento: "unchanged",
  new: "new",
  nueva: "new",
  decision_needed: "decision_needed",
  blocked_third_party: "blocked_third_party",
  waiting_authority: "waiting_authority",
};

type SessionJson = {
  meeting_id: string;
  series_id: string;
  topic_updates?: Array<{
    legacy_key: string;
    movement?: string;
    session_notes?: string;
    reviewed?: boolean;
  }>;
  decisions?: Array<{
    legacy_key: string;
    status?: string;
    resolution?: string;
    decided_at?: string;
  }>;
  discarded?: Array<{ legacy_key: string; reason?: string }>;
};

function concatNotes(existing: string | null, incoming: string | undefined): string | null {
  const a = (existing ?? "").trim();
  const b = (incoming ?? "").trim();
  if (!b) return a || null;
  if (!a) return b;
  if (a.includes(b)) return a;
  return `${a}\n${b}`;
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as SessionJson;
  const meetingId = raw.meeting_id;
  const seriesId = raw.series_id;
  if (!meetingId || !seriesId) throw new Error("meeting_id y series_id requeridos");

  const { data: meeting, error: mErr } = await sb
    .from("mtg_meetings")
    .select("id, organization_id")
    .eq("id", meetingId)
    .single();
  if (mErr || !meeting) throw mErr ?? new Error("junta no encontrada");

  const ownerEmail = process.env.OWNER_EMAIL || "leo.bassoco@kawiil.mx";
  const ownerUserId = process.env.OWNER_USER_ID;
  let actorId = ownerUserId ?? null;
  if (!actorId) {
    const { data: owner } = await sb
      .from("profiles")
      .select("user_id")
      .eq("email", ownerEmail)
      .maybeSingle();
    actorId = owner?.user_id ?? null;
  }

  let updatesPatched = 0;
  let decisionsPatched = 0;
  let skippedDiscarded = (raw.discarded ?? []).length;

  for (const item of raw.topic_updates ?? []) {
    const legacy = item.legacy_key;
    if (!legacy) continue;
    const { data: topic } = await sb
      .from("mtg_topics")
      .select("id")
      .eq("series_id", seriesId)
      .eq("legacy_key", legacy)
      .maybeSingle();
    if (!topic) {
      console.warn(`tema no encontrado legacy_key=${legacy}`);
      continue;
    }
    const { data: upd } = await sb
      .from("mtg_topic_updates")
      .select("id, movement, session_notes, reviewed")
      .eq("meeting_id", meetingId)
      .eq("topic_id", topic.id)
      .maybeSingle();
    if (!upd) {
      console.warn(`update no encontrado topic=${legacy} meeting=${meetingId}`);
      continue;
    }

    const movement =
      item.movement != null
        ? MOVEMENT_MAP[item.movement] ?? MOVEMENT_MAP[item.movement.toLowerCase()] ?? item.movement
        : upd.movement;
    const session_notes = concatNotes(upd.session_notes, item.session_notes);
    const reviewed = item.reviewed ?? upd.reviewed;

    const { error } = await sb
      .from("mtg_topic_updates")
      .update({
        movement,
        session_notes,
        reviewed,
        reviewed_at: reviewed ? new Date().toISOString() : null,
        origin: "edited_live",
      })
      .eq("id", upd.id);
    if (error) throw error;
    updatesPatched += 1;
  }

  for (const d of raw.decisions ?? []) {
    const legacy = d.legacy_key;
    if (!legacy) continue;
    const { data: topic } = await sb
      .from("mtg_topics")
      .select("id")
      .eq("series_id", seriesId)
      .eq("legacy_key", legacy)
      .maybeSingle();
    if (!topic) {
      console.warn(`decisión: tema no encontrado ${legacy}`);
      continue;
    }
    const { data: dec } = await sb
      .from("mtg_decisions")
      .select("id")
      .eq("meeting_id", meetingId)
      .eq("topic_id", topic.id)
      .maybeSingle();
    if (!dec) {
      console.warn(`decisión no encontrada topic=${legacy}`);
      continue;
    }
    const { error } = await sb
      .from("mtg_decisions")
      .update({
        status: d.status ?? "decided",
        resolution: d.resolution ?? null,
        decided_at: d.decided_at ?? new Date().toISOString(),
        decided_by_name: "Polo",
      })
      .eq("id", dec.id);
    if (error) throw error;
    decisionsPatched += 1;
  }

  await sb.from("mtg_audit_log").insert({
    organization_id: meeting.organization_id,
    actor_user_id: actorId,
    entity_type: "meeting",
    entity_id: meetingId,
    action: "session_notes_imported",
    details: {
      updates_patched: updatesPatched,
      decisions_patched: decisionsPatched,
      discarded_ignored: skippedDiscarded,
      source: jsonPath,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        meeting_id: meetingId,
        series_id: seriesId,
        updates_patched: updatesPatched,
        decisions_patched: decisionsPatched,
        discarded_ignored: skippedDiscarded,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
