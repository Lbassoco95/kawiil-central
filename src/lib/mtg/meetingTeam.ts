/**
 * Equipo interno de la junta: quién recibe el resumen (minuta) y los avisos.
 * Se guarda en `mtg_series.attendees_internal` (ya usado por recordatorios y minuta).
 */

import { mtgDb, type MtgMeetingRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { createNotifications } from "@/lib/notificationHelpers";

export function meetingTeamIds(
  series: Pick<MtgSeriesRow, "owner_user_id" | "attendees_internal"> | null | undefined,
): string[] {
  const ids = new Set<string>();
  if (series?.owner_user_id) ids.add(series.owner_user_id);
  for (const u of series?.attendees_internal ?? []) if (u) ids.add(u);
  return [...ids];
}

export async function saveMeetingTeam(opts: {
  seriesId: string;
  userIds: string[];
}): Promise<void> {
  const { error } = await mtgDb
    .from("mtg_series")
    .update({ attendees_internal: [...new Set(opts.userIds)] })
    .eq("id", opts.seriesId);
  if (error) throw new Error(error.message);
}

/** Avisa al equipo (excepto a quien actúa) con enlace a la minuta o al tablero. */
export async function notifyMeetingTeam(opts: {
  actorUserId: string;
  meeting: Pick<MtgMeetingRow, "id">;
  series: Pick<MtgSeriesRow, "owner_user_id" | "attendees_internal" | "title"> | null;
  kind: "added" | "minutes";
  title?: string | null;
}): Promise<void> {
  const label = opts.series?.title ?? opts.title ?? "Junta";
  const recipients = meetingTeamIds(opts.series);
  await createNotifications(
    recipients
      .filter((id) => id !== opts.actorUserId)
      .map((user_id) => ({
        user_id,
        type: opts.kind === "minutes" ? "mtg_minutes" : "mtg_team_added",
        title:
          opts.kind === "minutes"
            ? `Resumen de junta listo: ${label}`
            : `Te agregaron al equipo de la junta: ${label}`,
        body:
          opts.kind === "minutes"
            ? "La minuta fue aprobada. Ábrela para ver el resumen y los acuerdos."
            : "Recibirás el resumen cuando se apruebe la minuta.",
        entity_type: "meeting",
        entity_id: opts.meeting.id,
        source_user_id: opts.actorUserId,
      })),
  );
}
