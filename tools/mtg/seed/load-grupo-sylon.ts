/**
 * Carga Anexo A Grupo Sylon desde JSON fuera del repo.
 * Idempotente por legacy_key. NO versiona datos del cliente.
 *
 * Uso:
 *   SEED_JSON=~/Downloads/mtg-seed-grupo-sylon-2026-09-17.json \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx tools/mtg/seed/load-grupo-sylon.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const jsonPath =
  process.env.SEED_JSON ||
  resolve(process.env.HOME || "~", "Downloads/mtg-seed-grupo-sylon-2026-09-17.json");

if (!url || !key) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!existsSync(jsonPath)) {
  console.error(`JSON no encontrado: ${jsonPath}`);
  console.error("Coloca el archivo o pasa SEED_JSON=... y reintenta.");
  process.exit(2);
}

const MOVEMENT_MAP: Record<string, string> = {
  resuelta: "resolved",
  "avanzó": "advanced",
  avanzo: "advanced",
  sin_movimiento: "unchanged",
  nueva: "new",
  "decisión": "decision_needed",
  decision: "decision_needed",
  bloqueada_tercero: "blocked_third_party",
  con_autoridad: "waiting_authority",
};

const ORG = "a0000000-0000-0000-0000-000000000001";
const ENTITIES = [
  {
    key: "vizum",
    label: "Vizum",
    client_id: "5629ce71-0a5c-4c76-aa50-9ce22e0cf191",
  },
  {
    key: "sylon",
    label: "Sylon Capital (IFPE)",
    client_id: "c758ce0f-63bf-4ab4-8940-d9cfe45fb762",
  },
  {
    key: "rivium",
    label: "Sylon Asesores · Rivium",
    client_id: "616c8dea-48a3-4a8c-b6f9-661c82875880",
  },
];

const sb = createClient(url, key, { auth: { persistSession: false } });

type SeedJson = {
  agenda_items?: Array<Record<string, unknown>>;
  decisions_requested?: Array<Record<string, unknown>>;
  next_meeting_expected?: Array<Record<string, unknown>>;
};

async function main() {
  const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as SeedJson;
  const agenda = raw.agenda_items ?? [];
  const decisions = raw.decisions_requested ?? [];
  const expected = raw.next_meeting_expected ?? [];

  const { data: owner } = await sb
    .from("profiles")
    .select("user_id")
    .eq("email", "leo.bassoco@kawiil.mx")
    .maybeSingle();
  const ownerId = owner?.user_id;
  if (!ownerId) throw new Error("Owner leo.bassoco@kawiil.mx no encontrado");

  // 1) Grupo
  let groupId: string;
  const { data: gExist } = await sb
    .from("client_groups")
    .select("id")
    .eq("organization_id", ORG)
    .eq("name", "Grupo Sylon")
    .maybeSingle();
  if (gExist) {
    groupId = gExist.id;
  } else {
    const { data: g, error } = await sb
      .from("client_groups")
      .insert({
        organization_id: ORG,
        name: "Grupo Sylon",
        description: "Vizum + Sylon Capital + Sylon Asesores (Rivium)",
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error) throw error;
    groupId = g.id;
  }

  for (const e of ENTITIES) {
    await sb.from("client_group_members").upsert(
      { group_id: groupId, client_id: e.client_id },
      { onConflict: "group_id,client_id" },
    );
  }

  // 2) Serie
  const startsAt = "2026-09-10T16:00:00.000Z"; // 10:00 America/Mexico_City (CDT UTC-6)
  let seriesId: string;
  const { data: sExist } = await sb
    .from("mtg_series")
    .select("id")
    .eq("anchor_type", "group")
    .eq("anchor_id", groupId)
    .eq("title", "Seguimiento quincenal")
    .maybeSingle();
  if (sExist) {
    seriesId = sExist.id;
  } else {
    const { data: s, error } = await sb
      .from("mtg_series")
      .insert({
        organization_id: ORG,
        anchor_type: "group",
        anchor_id: groupId,
        client_id: null,
        title: "Seguimiento quincenal",
        cadence: "biweekly",
        starts_at: startsAt,
        default_duration_min: 90,
        owner_user_id: ownerId,
        entities: ENTITIES,
        auto_transcript: false,
        send_minutes_to_client: false,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error) throw error;
    seriesId = s.id;
  }

  // 3) Juntas 10-sep closed, 17-sep planned, 1-oct planned
  const meetingsSpec = [
    { at: "2026-09-10T16:00:00.000Z", status: "closed" },
    { at: "2026-09-17T16:00:00.000Z", status: "planned" },
    { at: "2026-10-01T16:00:00.000Z", status: "planned" },
  ];
  const meetingIds: Record<string, string> = {};
  for (const spec of meetingsSpec) {
    const day = spec.at.slice(0, 10);
    const { data: mExist } = await sb
      .from("mtg_meetings")
      .select("id")
      .eq("series_id", seriesId)
      .gte("scheduled_at", `${day}T00:00:00.000Z`)
      .lt("scheduled_at", `${day}T23:59:59.999Z`)
      .maybeSingle();
    if (mExist) {
      meetingIds[day] = mExist.id;
      await sb.from("mtg_meetings").update({ status: spec.status }).eq("id", mExist.id);
    } else {
      const { data: m, error } = await sb
        .from("mtg_meetings")
        .insert({
          organization_id: ORG,
          series_id: seriesId,
          client_id: null,
          scheduled_at: spec.at,
          status: spec.status,
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (error) throw error;
      meetingIds[day] = m.id;
    }
  }
  const meeting17 = meetingIds["2026-09-17"];

  // 4) Temas + updates
  let topicsCreated = 0;
  let updatesCreated = 0;
  for (const item of agenda) {
    const legacy = String(item.id ?? item.legacy_key ?? "");
    const entityKey = String(item.entity ?? item.entity_key ?? "");
    const ent = ENTITIES.find((e) => e.key === entityKey);
    if (!legacy || !ent) continue;

    let topicId: string;
    const { data: tExist } = await sb
      .from("mtg_topics")
      .select("id")
      .eq("series_id", seriesId)
      .eq("legacy_key", legacy)
      .maybeSingle();
    if (tExist) {
      topicId = tExist.id;
    } else {
      const { data: t, error } = await sb
        .from("mtg_topics")
        .insert({
          organization_id: ORG,
          series_id: seriesId,
          client_id: ent.client_id,
          entity_key: entityKey,
          title: String(item.title ?? item.tema ?? ""),
          context: (item.context as string) ?? null,
          source: (item.source as string) ?? null,
          if_asked: (item.if_asked as string) ?? null,
          owner_name: (item.owner as string) ?? null,
          due_date: (item.due_date as string) ?? null,
          legacy_key: legacy,
          status: "open",
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (error) throw error;
      topicId = t.id;
      topicsCreated++;
    }

    const movRaw = String(item.movement ?? item.movimiento ?? "sin_movimiento");
    const movement = MOVEMENT_MAP[movRaw] ?? MOVEMENT_MAP[movRaw.toLowerCase()] ?? "unchanged";

    const { data: uExist } = await sb
      .from("mtg_topic_updates")
      .select("id")
      .eq("meeting_id", meeting17)
      .eq("topic_id", topicId)
      .maybeSingle();
    if (!uExist) {
      await sb.from("mtg_topic_updates").insert({
        organization_id: ORG,
        topic_id: topicId,
        meeting_id: meeting17,
        movement,
        progress_since_last: (item.progress_since_last as string) ?? null,
        next_step: (item.next_step as string) ?? null,
        origin: "prepared",
      });
      updatesCreated++;
    }
  }

  // 5) Decisiones
  let decisionsCreated = 0;
  for (const [i, d] of decisions.entries()) {
    const text = String(d.text ?? d.decision ?? "");
    if (!text) continue;
    const { data: dExist } = await sb
      .from("mtg_decisions")
      .select("id")
      .eq("meeting_id", meeting17)
      .eq("text", text)
      .maybeSingle();
    if (dExist) continue;
    const entityKey = (d.entity as string) ?? null;
    const ent = ENTITIES.find((e) => e.key === entityKey);
    let topicId: string | null = null;
    if (d.topic_id || d.agenda_item_id) {
      const { data: t } = await sb
        .from("mtg_topics")
        .select("id")
        .eq("series_id", seriesId)
        .eq("legacy_key", String(d.topic_id ?? d.agenda_item_id))
        .maybeSingle();
      topicId = t?.id ?? null;
    }
    await sb.from("mtg_decisions").insert({
      organization_id: ORG,
      meeting_id: meeting17,
      client_id: ent?.client_id ?? null,
      entity_key: entityKey,
      topic_id: topicId,
      text,
      status: "pending",
      sort_order: i,
      created_by: ownerId,
    });
    decisionsCreated++;
  }

  // 6) Expected next
  let expectedCreated = 0;
  for (const [i, e] of expected.entries()) {
    const text = String(e.text ?? e.item ?? "");
    if (!text) continue;
    const { data: eExist } = await sb
      .from("mtg_expected_next")
      .select("id")
      .eq("meeting_id", meeting17)
      .eq("text", text)
      .maybeSingle();
    if (eExist) continue;
    const entityKey = (e.entity as string) ?? null;
    const ent = ENTITIES.find((x) => x.key === entityKey);
    await sb.from("mtg_expected_next").insert({
      organization_id: ORG,
      meeting_id: meeting17,
      client_id: ent?.client_id ?? null,
      entity_key: entityKey,
      text,
      sort_order: i,
    });
    expectedCreated++;
  }

  await sb.from("mtg_audit_log").insert({
    organization_id: ORG,
    actor_user_id: ownerId,
    entity_type: "series",
    entity_id: seriesId,
    action: "seed_loaded",
    details: {
      agenda: agenda.length,
      topics_created: topicsCreated,
      updates_created: updatesCreated,
      decisions_created: decisionsCreated,
      expected_created: expectedCreated,
      meeting_17: meeting17,
    },
  });

  const { count: topicCount } = await sb
    .from("mtg_topics")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId);
  const { count: updateCount } = await sb
    .from("mtg_topic_updates")
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", meeting17);

  console.log(
    JSON.stringify(
      {
        ok: true,
        groupId,
        seriesId,
        meeting17,
        topicCount,
        updateCount,
        agendaInJson: agenda.length,
        decisionsInJson: decisions.length,
        expectedInJson: expected.length,
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
