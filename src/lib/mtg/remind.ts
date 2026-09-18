/**
 * Recordatorios T-1 día / T-1 hora (B5).
 * Jobs `mtg.remind` en job_queue; idempotentes por (meeting_id, remind_kind).
 */

import { supabase } from "@/integrations/supabase/client";
import { remindKindsForMeeting } from "@/lib/mtg/minutesReview";
import type { MtgMeetingRow, MtgSeriesRow } from "@/lib/mtg/db";

export type RemindKind = "t1d" | "t1h";

export async function enqueueRemindersForMeeting(opts: {
  organizationId: string;
  meeting: Pick<MtgMeetingRow, "id" | "scheduled_at" | "status">;
  series?: Pick<MtgSeriesRow, "owner_user_id" | "attendees_internal" | "title"> | null;
  now?: Date;
}): Promise<number> {
  if (opts.meeting.status === "cancelled" || opts.meeting.status === "closed") return 0;

  const kinds = remindKindsForMeeting(new Date(opts.meeting.scheduled_at), opts.now ?? new Date());
  let inserted = 0;

  for (const k of kinds) {
    const { data: existing } = await supabase
      .from("job_queue" as never)
      .select("id")
      .eq("kind", "mtg.remind")
      .in("status", ["pending", "leased"] as never)
      .contains("payload", {
        meeting_id: opts.meeting.id,
        remind_kind: k.remind_kind,
      } as never)
      .limit(1);

    if (existing && (existing as unknown[]).length > 0) continue;

    const { error } = await supabase.from("job_queue" as never).insert({
      organization_id: opts.organizationId,
      kind: "mtg.remind",
      payload: {
        meeting_id: opts.meeting.id,
        remind_kind: k.remind_kind,
        title: opts.series?.title ?? null,
        owner_user_id: opts.series?.owner_user_id ?? null,
        attendees_internal: opts.series?.attendees_internal ?? [],
      },
      status: "pending",
      run_after: k.run_after.toISOString(),
    } as never);
    if (!error) inserted += 1;
  }
  return inserted;
}

/** Cancela recordatorios pendientes/leased de una junta. */
export async function cancelRemindersForMeeting(meetingId: string): Promise<number> {
  const { data, error } = await supabase
    .from("job_queue" as never)
    .update({
      status: "dead",
      last_error: "meeting_cancelled",
      completed_at: new Date().toISOString(),
    } as never)
    .eq("kind", "mtg.remind")
    .in("status", ["pending", "leased"] as never)
    .contains("payload", { meeting_id: meetingId } as never)
    .select("id");
  if (error) {
    console.warn("[mtg] cancelReminders", error.message);
    return 0;
  }
  return (data as unknown[] | null)?.length ?? 0;
}

export function remindRecipientIds(series: {
  owner_user_id?: string | null;
  attendees_internal?: string[] | null;
}): string[] {
  const ids = new Set<string>();
  if (series.owner_user_id) ids.add(series.owner_user_id);
  for (const u of series.attendees_internal ?? []) {
    if (u) ids.add(u);
  }
  return [...ids];
}

export function remindNotificationCopy(
  remindKind: RemindKind,
  title: string,
  meetingId: string,
): { title: string; body: string; link: string } {
  const when = remindKind === "t1d" ? "mañana" : "en una hora";
  return {
    title: `Recordatorio de junta (${when})`,
    body: `${title} — abre /juntas/${meetingId}`,
    link: `/juntas/${meetingId}`,
  };
}
