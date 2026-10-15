/**
 * Ciclo de vida de la junta: iniciar / terminar / cancelar.
 */

import { mtgDb, type MtgMeetingRow, type MtgTopicUpdateRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";
import type { MtgMeetingStatus } from "@/lib/mtg/constants";
import { cancelRemindersForMeeting } from "@/lib/mtg/remind";

export function assertCanStart(status: MtgMeetingStatus): void {
  if (status !== "planned") throw new Error(`No se puede iniciar desde estado ${status}`);
}

export function assertCanEnd(status: MtgMeetingStatus): void {
  if (status !== "in_progress" && status !== "planned") {
    throw new Error(`No se puede terminar desde estado ${status}`);
  }
}

export function assertCanCancel(status: MtgMeetingStatus): void {
  if (status !== "planned" && status !== "in_progress") {
    throw new Error(`No se puede cancelar desde estado ${status}`);
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

export async function cancelMeeting(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
}): Promise<MtgMeetingRow> {
  assertCanCancel(opts.meeting.status);
  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .update({ status: "cancelled" })
    .eq("id", opts.meeting.id)
    .select("*")
    .single();
  if (error) throw error;

  await cancelRemindersForMeeting(opts.meeting.id);

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.MEETING_CANCELLED,
  });
  return data as MtgMeetingRow;
}

export function unreviewedCount(updates: { reviewed: boolean }[]): number {
  return updates.filter((u) => !u.reviewed).length;
}

const ARCHIVABLE_STATUSES: MtgMeetingStatus[] = [
  "ended",
  "minutes_draft",
  "minutes_review",
  "minutes_approved",
  "closed",
  "cancelled",
  "no_show",
];

export function canArchive(meeting: Pick<MtgMeetingRow, "status" | "archived_at">): boolean {
  return !meeting.archived_at && ARCHIVABLE_STATUSES.includes(meeting.status);
}

/** Archiva una junta ya terminada: se oculta de la vista general, conserva todo. */
export async function archiveMeeting(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
}): Promise<MtgMeetingRow> {
  if (!canArchive(opts.meeting)) {
    throw new Error("Solo se pueden archivar juntas que ya terminaron o se cancelaron.");
  }
  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", opts.meeting.id)
    .select("*")
    .single();
  if (error) throw error;
  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.MEETING_ARCHIVED,
  });
  return data as MtgMeetingRow;
}

export async function unarchiveMeeting(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
}): Promise<MtgMeetingRow> {
  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .update({ archived_at: null })
    .eq("id", opts.meeting.id)
    .select("*")
    .single();
  if (error) throw error;
  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.MEETING_UNARCHIVED,
  });
  return data as MtgMeetingRow;
}

/** Qué tiene guardado una junta (para decidir si se puede eliminar sin perder nada). */
export type MeetingContentSummary = {
  isEmpty: boolean;
  reasons: string[];
};

export async function getMeetingContentSummary(
  meeting: Pick<MtgMeetingRow, "id" | "recording_path" | "transcript_path" | "minutes_id">,
): Promise<MeetingContentSummary> {
  const reasons: string[] = [];
  if (meeting.recording_path) reasons.push("grabación");
  if (meeting.transcript_path) reasons.push("transcripción");
  if (meeting.minutes_id) reasons.push("minuta");

  const count = async (table: string, extra?: (q: any) => any) => {
    let q = mtgDb.from(table).select("id", { count: "exact", head: true }).eq("meeting_id", meeting.id);
    if (extra) q = extra(q);
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };

  const [recordings, minutes, agreements, decisions, editedUpdates] = await Promise.all([
    count("mtg_meeting_recordings"),
    count("mtg_minutes"),
    count("mtg_agreements"),
    count("mtg_decisions"),
    // 'prepared' = relleno automático del tablero; lo demás lo escribió una persona o el modelo.
    count("mtg_topic_updates", (q) => q.neq("origin", "prepared")),
  ]);
  if (recordings) reasons.push("grabaciones");
  if (minutes && !reasons.includes("minuta")) reasons.push("minuta");
  if (agreements) reasons.push("acuerdos");
  if (decisions) reasons.push("decisiones");
  if (editedUpdates) reasons.push("notas en temas");

  return { isEmpty: reasons.length === 0, reasons };
}

/**
 * Elimina una junta SOLO si no tiene nada guardado. Con contenido, hay que
 * cancelarla (se conserva el historial). El borrado exige admin/manager (RLS).
 */
export async function deleteEmptyMeeting(opts: {
  organizationId: string;
  actorUserId: string;
  meeting: MtgMeetingRow;
}): Promise<void> {
  const summary = await getMeetingContentSummary(opts.meeting);
  if (!summary.isEmpty) {
    throw new Error(
      `Esta junta tiene ${summary.reasons.join(", ")}; no se puede eliminar. Cancélala para conservar el historial.`,
    );
  }
  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .delete()
    .eq("id", opts.meeting.id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("No se eliminó: solo admin/manager pueden borrar juntas.");
  }

  await cancelRemindersForMeeting(opts.meeting.id);
  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meeting.id,
    action: MTG_AUDIT_ACTION.MEETING_DELETED,
    snapshot: {
      title: opts.meeting.title,
      scheduled_at: opts.meeting.scheduled_at,
      status: opts.meeting.status,
    },
  });
}
