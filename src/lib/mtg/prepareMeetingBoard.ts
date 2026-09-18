/**
 * Orquestación: al abrir junta planned sin updates, materializa topic_updates.
 */

import { mtgDb, type MtgMeetingRow, type MtgSeriesRow, type MtgTopicRow } from "@/lib/mtg/db";
import { buildPreparedUpdates, canPrepareBoard } from "@/lib/mtg/prepareBoard";

export async function prepareMeetingBoard(opts: {
  meeting: MtgMeetingRow;
  series: MtgSeriesRow | null;
}): Promise<{ created: number; skipped: boolean }> {
  const { meeting, series } = opts;
  if (!series) return { created: 0, skipped: true };

  const { count, error: cErr } = await mtgDb
    .from("mtg_topic_updates")
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", meeting.id);
  if (cErr) throw cErr;

  if (!canPrepareBoard(meeting.status, count ?? 0)) {
    return { created: 0, skipped: true };
  }

  const { data: openTopics, error: tErr } = await mtgDb
    .from("mtg_topics")
    .select("*")
    .eq("series_id", series.id)
    .eq("status", "open");
  if (tErr) throw tErr;
  const topics = (openTopics ?? []) as MtgTopicRow[];
  if (topics.length === 0) return { created: 0, skipped: false };

  // Junta anterior de la serie (por scheduled_at)
  const { data: prevMeetings } = await mtgDb
    .from("mtg_meetings")
    .select("id")
    .eq("series_id", series.id)
    .lt("scheduled_at", meeting.scheduled_at)
    .order("scheduled_at", { ascending: false })
    .limit(1);

  const prevId = prevMeetings?.[0]?.id;
  const previousByTopicId = new Map<
    string,
    { movement: MtgTopicRow extends never ? never : import("@/lib/mtg/db").MtgTopicUpdateRow["movement"]; next_step: string | null }
  >();

  if (prevId) {
    const { data: prevUpdates } = await mtgDb
      .from("mtg_topic_updates")
      .select("topic_id, movement, next_step")
      .eq("meeting_id", prevId);
    for (const u of prevUpdates ?? []) {
      previousByTopicId.set(u.topic_id, {
        movement: u.movement,
        next_step: u.next_step,
      });
    }
  }

  const seeds = buildPreparedUpdates({
    openTopics: topics.map((t) => ({ id: t.id })),
    previousByTopicId,
  });

  const rows = seeds.map((s) => ({
    organization_id: meeting.organization_id,
    topic_id: s.topic_id,
    meeting_id: meeting.id,
    movement: s.movement,
    next_step: s.next_step,
    progress_since_last: null,
    origin: s.origin,
    reviewed: false,
  }));

  const { error: iErr } = await mtgDb.from("mtg_topic_updates").insert(rows);
  if (iErr) throw iErr;

  return { created: rows.length, skipped: false };
}
