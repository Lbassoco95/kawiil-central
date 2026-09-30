/**
 * Carga demo sintético (VITE_MTG_DEMO=1 / local).
 * Sin nombres reales de clientes de producción.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tools/mtg/seed/load-demo.ts
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const ORG = "a0000000-0000-0000-0000-000000000001";
const DEMO_CLIENT_NAME = "Demo Tzolk'in S.A. de C.V.";

async function main() {
  const { data: owner } = await sb
    .from("profiles")
    .select("user_id")
    .eq("organization_id", ORG)
    .limit(1)
    .maybeSingle();
  if (!owner) throw new Error("Sin profiles en org demo");

  let clientId: string;
  const { data: existing } = await sb
    .from("clients")
    .select("id")
    .eq("organization_id", ORG)
    .eq("name", DEMO_CLIENT_NAME)
    .maybeSingle();

  if (existing) {
    clientId = existing.id;
  } else {
    const { data: c, error } = await sb
      .from("clients")
      .insert({
        organization_id: ORG,
        name: DEMO_CLIENT_NAME,
        client_type: "persona_moral",
        status: "activo",
        created_by: owner.user_id,
      })
      .select("id")
      .single();
    if (error) throw error;
    clientId = c.id;
  }

  const { data: seriesExisting } = await sb
    .from("mtg_series")
    .select("id")
    .eq("client_id", clientId)
    .eq("title", "Seguimiento semanal demo")
    .maybeSingle();

  let seriesId = seriesExisting?.id as string | undefined;
  if (!seriesId) {
    const { data: s, error } = await sb
      .from("mtg_series")
      .insert({
        organization_id: ORG,
        anchor_type: "client",
        anchor_id: clientId,
        client_id: clientId,
        title: "Seguimiento semanal demo",
        cadence: "weekly",
        starts_at: new Date().toISOString(),
        owner_user_id: owner.user_id,
        entities: [{ key: "demo", label: "Demo", client_id: clientId }],
        created_by: owner.user_id,
        auto_transcript: false,
        send_minutes_to_client: false,
      })
      .select("id")
      .single();
    if (error) throw error;
    seriesId = s.id;
  }

  const { data: meetingExisting } = await sb
    .from("mtg_meetings")
    .select("id")
    .eq("series_id", seriesId)
    .eq("status", "planned")
    .limit(1)
    .maybeSingle();

  let meetingId = meetingExisting?.id as string | undefined;
  if (!meetingId) {
    const { data: m, error } = await sb
      .from("mtg_meetings")
      .insert({
        organization_id: ORG,
        series_id: seriesId,
        client_id: clientId,
        scheduled_at: new Date().toISOString(),
        status: "planned",
        created_by: owner.user_id,
      })
      .select("id")
      .single();
    if (error) throw error;
    meetingId = m.id;
  }

  const titles = [
    "Cierre contable del mes",
    "Declaración provisional",
    "Contrato pendiente de firma",
    "Onboarding de proveedor",
    "Reporte CNBV demo",
    "Capacitación interna",
  ];
  for (const [i, title] of titles.entries()) {
    const legacy = `demo-topic-${i}`;
    const { data: tExist } = await sb
      .from("mtg_topics")
      .select("id")
      .eq("series_id", seriesId)
      .eq("legacy_key", legacy)
      .maybeSingle();
    if (tExist) continue;
    const { data: t, error } = await sb
      .from("mtg_topics")
      .insert({
        organization_id: ORG,
        series_id: seriesId,
        client_id: clientId,
        entity_key: "demo",
        title,
        legacy_key: legacy,
        status: "open",
        sort_order: i,
        created_by: owner.user_id,
      })
      .select("id")
      .single();
    if (error) throw error;
    await sb.from("mtg_topic_updates").insert({
      organization_id: ORG,
      topic_id: t.id,
      meeting_id: meetingId,
      movement: i === 0 ? "new" : i === 1 ? "decision_needed" : "unchanged",
      origin: "prepared",
    });
  }

  for (const [i, text] of ["¿Se aprueba el alcance?", "¿Fecha de entrega al cliente?"].entries()) {
    const { data: d } = await sb
      .from("mtg_decisions")
      .select("id")
      .eq("meeting_id", meetingId)
      .eq("text", text)
      .maybeSingle();
    if (d) continue;
    await sb.from("mtg_decisions").insert({
      organization_id: ORG,
      meeting_id: meetingId,
      client_id: clientId,
      entity_key: "demo",
      text,
      status: "pending",
      sort_order: i,
      created_by: owner.user_id,
    });
  }

  console.log(JSON.stringify({ ok: true, clientId, seriesId, meetingId }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
