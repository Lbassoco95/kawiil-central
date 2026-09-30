/**
 * Crear o reutilizar una junta Múuch' a partir de un evento de calendario.
 * Sin cliente obligatorio (prospecto / interna).
 */

import { mtgDb, type MtgMeetingRow } from "@/lib/mtg/db";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

export type CalendarMeetingSource = {
  outlookEventId: string;
  title: string;
  scheduledAt: string; // ISO
  durationMin?: number | null;
  teamsJoinUrl?: string | null;
  teamsOnlineMeetingId?: string | null;
  clientId?: string | null;
};

export async function findOrCreateMeetingFromCalendar(opts: {
  organizationId: string;
  actorUserId: string;
  source: CalendarMeetingSource;
}): Promise<{ meeting: MtgMeetingRow; created: boolean }> {
  const eventId = opts.source.outlookEventId.trim();
  if (!eventId) throw new Error("Falta el id del evento de calendario");

  const { data: existing, error: findErr } = await mtgDb
    .from("mtg_meetings")
    .select("*")
    .eq("organization_id", opts.organizationId)
    .eq("outlook_event_id", eventId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) {
    return { meeting: existing as MtgMeetingRow, created: false };
  }

  const { data, error } = await mtgDb
    .from("mtg_meetings")
    .insert({
      organization_id: opts.organizationId,
      series_id: null,
      client_id: opts.source.clientId ?? null,
      title: opts.source.title.trim() || "Junta",
      scheduled_at: opts.source.scheduledAt,
      duration_min: opts.source.durationMin ?? null,
      facilitator_user_id: opts.actorUserId,
      outlook_event_id: eventId,
      teams_join_url: opts.source.teamsJoinUrl ?? null,
      teams_online_meeting_id: opts.source.teamsOnlineMeetingId ?? null,
      created_by: opts.actorUserId,
    })
    .select("*")
    .single();
  if (error) throw error;

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: data.id,
    action: MTG_AUDIT_ACTION.MEETING_CREATED,
    details: {
      origin: "calendar",
      outlook_event_id: eventId,
      has_teams: !!opts.source.teamsJoinUrl,
      unassigned: !opts.source.clientId,
    },
    snapshot: data as unknown as Record<string, unknown>,
  });

  return { meeting: data as MtgMeetingRow, created: true };
}
