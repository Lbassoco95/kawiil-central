/**
 * Guarda (o limpia) el link de videollamada de una junta.
 */

import { mtgDb, type MtgMeetingRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";
import { parseMeetingJoinLink } from "@/lib/mtg/joinLink";

export async function setMeetingJoinLink(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  /** Texto pegado; null/"" limpia el link. */
  rawLink: string | null;
}): Promise<MtgMeetingRow> {
  let teams_join_url: string | null = null;
  let teams_online_meeting_id: string | null = opts.meeting.teams_online_meeting_id;
  let provider: string | null = null;

  const raw = (opts.rawLink ?? "").trim();
  if (raw) {
    const parsed = parseMeetingJoinLink(raw);
    teams_join_url = parsed.url;
    provider = parsed.provider;
    if (parsed.teamsOnlineMeetingId) {
      teams_online_meeting_id = parsed.teamsOnlineMeetingId;
    }
  } else {
    teams_join_url = null;
    // No borramos teams_online_meeting_id si venía de Graph/Outlook.
  }

  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .update({
      teams_join_url,
      teams_online_meeting_id,
    })
    .eq("id", opts.meeting.id)
    .select("*")
    .single();
  if (error) throw error;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.MEETING_JOIN_LINK_SET,
    details: {
      teams_join_url,
      teams_online_meeting_id,
      provider,
      cleared: !teams_join_url,
    },
  });

  return data as MtgMeetingRow;
}
