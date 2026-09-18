/**
 * Ciclo de vida de la junta: iniciar / terminar.
 */

import { mtgDb, type MtgMeetingRow, type MtgTopicUpdateRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";
import type { MtgMeetingStatus } from "@/lib/mtg/constants";

export function assertCanStart(status: MtgMeetingStatus): void {
  if (status !== "planned") throw new Error(`No se puede iniciar desde estado ${status}`);
}

export function assertCanEnd(status: MtgMeetingStatus): void {
  if (status !== "in_progress" && status !== "planned") {
    throw new Error(`No se puede terminar desde estado ${status}`);
  }
}

export async function startMeeting(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
}): Promise<MtgMeetingRow> {
  assertCanStart(opts.meeting.status);
  const now = new Date().toISOString();
  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .update({ status: "in_progress", started_at: now })
    .eq("id", opts.meeting.id)
    .select("*")
    .single();
  if (error) throw error;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.MEETING_STARTED,
    details: { started_at: now },
  });
  return data as MtgMeetingRow;
}

export interface EndMeetingOptions {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
  /** Updates de esta junta (para marcar resolved en topics). */
  updates: Pick<MtgTopicUpdateRow, "topic_id" | "movement" | "reviewed">[];
  pendingDecisionIds: string[];
  /** Si true, encola generate_minutes (B4); si no, metadata.minutes_pending. */
  enqueueMinutes?: boolean;
}

export async function endMeeting(opts: EndMeetingOptions): Promise<MtgMeetingRow> {
  assertCanEnd(opts.meeting.status);
  const now = new Date().toISOString();

  const resolvedTopicIds = [
    ...new Set(
      opts.updates.filter((u) => u.movement === "resolved").map((u) => u.topic_id),
    ),
  ];
  if (resolvedTopicIds.length > 0) {
    await mtgDb
      .from("mtg_topics")
      .update({
        status: "resolved",
        resolved_in_meeting_id: opts.meeting.id,
      })
      .in("id", resolvedTopicIds);
  }

  if (opts.pendingDecisionIds.length > 0) {
    await mtgDb
      .from("mtg_decisions")
      .update({ status: "deferred" })
      .in("id", opts.pendingDecisionIds);
  }

  const patch: Record<string, unknown> = {
    status: "ended",
    ended_at: now,
  };

  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .update(patch)
    .eq("id", opts.meeting.id)
    .select("*")
    .single();
  if (error) throw error;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.MEETING_ENDED,
    details: {
      ended_at: now,
      resolved_topics: resolvedTopicIds.length,
      deferred_decisions: opts.pendingDecisionIds.length,
      minutes_pending: !opts.enqueueMinutes,
    },
  });

  if (opts.enqueueMinutes) {
    // B3/B4: job_queue. Si la tabla aún no existe, se ignora.
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.from("job_queue" as never).insert({
        organization_id: opts.organizationId,
        kind: "mtg.generate_minutes",
        payload: { meeting_id: opts.meeting.id },
        status: "pending",
      } as never);
    } catch (e) {
      console.warn("[mtg] enqueue minutes skipped", e);
    }
  }

  return data as MtgMeetingRow;
}

export function unreviewedCount(updates: { reviewed: boolean }[]): number {
  return updates.filter((u) => !u.reviewed).length;
}
