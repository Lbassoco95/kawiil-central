/**
 * Bitácora del módulo de Juntas (Múuch').
 *
 * Escribe en `mtg_audit_log` (append-only en la base: UPDATE/DELETE están
 * prohibidos por trigger y por permisos) y además deja una línea resumen en
 * `activity_log` con entity_type `mtg_<entidad>` para que la acción aparezca
 * en la actividad general.
 */

import { mtgDb, type MtgAuditLogRow } from "@/lib/mtg/db";
import { logEntityActivity } from "@/lib/activityLog";

export const MTG_AUDIT_ACTION = {
  SERIES_CREATED: "series_created",
  SERIES_UPDATED: "series_updated",
  MEETING_CREATED: "meeting_created",
  MEETING_STARTED: "meeting_started",
  MEETING_ENDED: "meeting_ended",
  TOPIC_CREATED: "topic_created",
  TOPIC_DROPPED: "topic_dropped",
  AGREEMENT_CAPTURED: "agreement_captured",
  AGREEMENT_CONFIRMED: "agreement_confirmed",
  AGREEMENT_REJECTED: "agreement_rejected",
  DECISION_DECIDED: "decision_decided",
  MINUTES_APPROVED: "minutes_approved",
  MINUTES_SENT: "minutes_sent",
  TRANSCRIPT_NOTICE_CONFIRMED: "transcript_notice_confirmed",
  TRANSCRIPT_RECEIVED: "transcript_received",
  TRANSCRIPT_UNAVAILABLE: "transcript_unavailable",
} as const;

export type MtgAuditAction = (typeof MTG_AUDIT_ACTION)[keyof typeof MTG_AUDIT_ACTION];

export interface LogMtgAuditParams {
  organizationId: string;
  actorUserId: string;
  entityType: MtgAuditLogRow["entity_type"];
  entityId: string;
  action: MtgAuditAction;
  snapshot?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export async function logMtgAudit({
  organizationId,
  actorUserId,
  entityType,
  entityId,
  action,
  snapshot,
  details,
}: LogMtgAuditParams): Promise<void> {
  const { error } = await mtgDb.from("mtg_audit_log").insert({
    organization_id: organizationId,
    actor_user_id: actorUserId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    snapshot: snapshot ?? null,
    details: details ?? null,
  });
  if (error) console.warn("[mtg_audit_log]", error.message);

  await logEntityActivity(actorUserId, organizationId, {
    entityType: `mtg_${entityType}`,
    entityId,
    action,
    details: details ?? null,
  });
}
