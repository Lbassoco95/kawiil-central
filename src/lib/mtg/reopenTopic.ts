/**
 * Reabrir tema archivado en la junta actual.
 */

import { mtgDb, type MtgMeetingRow, type MtgTopicRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

export async function reopenTopicInMeeting(opts: {
  organizationId: string;
  actorUserId: string;
  topic: Pick<MtgTopicRow, "id" | "status">;
  meeting: Pick<MtgMeetingRow, "id">;
}): Promise<void> {
  if (opts.topic.status === "open") {
    throw new Error("El tema ya está abierto");
  }

  const { error: tErr } = await mtgDb
    .from("mtg_topics")
    .update({
      status: "open",
      resolved_in_meeting_id: null,
      dropped_reason: null,
    })
    .eq("id", opts.topic.id);
  if (tErr) throw tErr;

  const { data: existing } = await mtgDb
    .from("mtg_topic_updates")
    .select("id")
    .eq("meeting_id", opts.meeting.id)
    .eq("topic_id", opts.topic.id)
    .maybeSingle();

  if (existing) {
    const { error } = await mtgDb
      .from("mtg_topic_updates")
      .update({
        movement: "new",
        origin: "edited_live",
        reviewed: false,
      })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await mtgDb.from("mtg_topic_updates").insert({
      organization_id: opts.organizationId,
      topic_id: opts.topic.id,
      meeting_id: opts.meeting.id,
      movement: "new",
      origin: "edited_live",
      reviewed: false,
    });
    if (error) throw error;
  }

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "topic",
    entityId: opts.topic.id,
    action: MTG_AUDIT_ACTION.TOPIC_REOPENED,
    details: { meeting_id: opts.meeting.id },
  });
}
