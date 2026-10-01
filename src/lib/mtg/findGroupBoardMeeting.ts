/**
 * Si el usuario abrió una junta vacía/ad hoc del calendario el mismo día
 * que ya existe el tablero de serie (grupo multi-cliente con plantilla),
 * devolvemos esa junta para redirigir y no perder el contenido del DOCX.
 */

import { mtgDb, type MtgMeetingRow } from "@/lib/mtg/db";

export async function findGroupBoardMeetingForDay(opts: {
  organizationId: string;
  scheduledAt: string;
  excludeMeetingId: string;
}): Promise<Pick<MtgMeetingRow, "id" | "title" | "series_id" | "status"> | null> {
  const day = opts.scheduledAt.slice(0, 10);
  const dayStart = `${day}T00:00:00.000Z`;
  const dayEnd = `${day}T23:59:59.999Z`;

  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .select("id, title, series_id, status, scheduled_at")
    .eq("organization_id", opts.organizationId)
    .not("series_id", "is", null)
    .neq("id", opts.excludeMeetingId)
    .neq("status", "cancelled")
    .gte("scheduled_at", dayStart)
    .lte("scheduled_at", dayEnd)
    .order("scheduled_at", { ascending: true })
    .limit(8);
  if (error) throw error;

  for (const m of data ?? []) {
    if (!m.series_id) continue;
    const { count } = await mtgDb
      .from("mtg_topic_updates")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", m.id);
    if ((count ?? 0) > 0) {
      return {
        id: m.id,
        title: m.title,
        series_id: m.series_id,
        status: m.status,
      };
    }
  }
  return null;
}

/** Junta ad hoc vacía (sin serie / sin updates) candidata a redirigir al tablero de grupo. */
export function shouldSeekGroupBoard(meeting: {
  series_id: string | null;
  status: string;
  topicUpdateCount: number;
}): boolean {
  if (meeting.status === "cancelled") return true;
  if (!meeting.series_id && meeting.topicUpdateCount === 0) return true;
  return false;
}
