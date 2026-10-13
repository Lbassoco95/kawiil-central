/**
 * Equipo interno de la junta: quién recibe el resumen (minuta) y los avisos.
 * Se guarda en `mtg_series.attendees_internal` (ya usado por recordatorios y minuta).
 */

import { mtgDb, type MtgMeetingRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { supabase } from "@/integrations/supabase/client";
import { minutesToHtml } from "@/lib/mtg/minutesEmail";
import { createNotifications } from "@/lib/notificationHelpers";

type TeamSeries = Pick<MtgSeriesRow, "owner_user_id" | "attendees_internal">;
type TeamMeeting = Pick<MtgMeetingRow, "attendees_internal">;

/** Equipo = responsable y asistentes de la serie (si hay) + los agregados a esta junta. */
export function meetingTeamIds(
  series: TeamSeries | null | undefined,
  meeting?: Partial<TeamMeeting> | null,
): string[] {
  const ids = new Set<string>();
  if (series?.owner_user_id) ids.add(series.owner_user_id);
  for (const u of series?.attendees_internal ?? []) if (u) ids.add(u);
  for (const u of meeting?.attendees_internal ?? []) if (u) ids.add(u);
  return [...ids];
}

/** Guarda el equipo propio de la junta (funciona con o sin serie). */
export async function saveMeetingTeam(opts: {
  meetingId: string;
  userIds: string[];
}): Promise<void> {
  const { error } = await mtgDb
    .from("mtg_meetings")
    .update({ attendees_internal: [...new Set(opts.userIds)] })
    .eq("id", opts.meetingId);
  if (error) throw new Error(error.message);
}

/** Avisa al equipo (excepto a quien actúa) con enlace a la minuta o al tablero. */
export async function notifyMeetingTeam(opts: {
  actorUserId: string;
  meeting: Pick<MtgMeetingRow, "id"> & Partial<TeamMeeting>;
  series: (TeamSeries & { title?: string }) | null;
  kind: "added" | "minutes";
  title?: string | null;
  /** Si se pasa, avisa solo a estas personas (p. ej. las recién agregadas). */
  onlyUserIds?: string[];
}): Promise<void> {
  const label = opts.series?.title ?? opts.title ?? "Junta";
  const recipients = opts.onlyUserIds ?? meetingTeamIds(opts.series, opts.meeting);
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

function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Envía el resumen (minuta aprobada) por correo al equipo, desde el Outlook de
 * quien aprueba (microsoft-api). Devuelve cuántos destinatarios recibieron el correo;
 * 0 si no hay equipo con correo o Outlook no está conectado (no lanza).
 */
export async function emailMeetingTeamSummary(opts: {
  actorUserId: string;
  meeting: Pick<MtgMeetingRow, "id" | "scheduled_at" | "title"> & Partial<TeamMeeting>;
  series: (TeamSeries & { title?: string }) | null;
  contentMd: string;
}): Promise<number> {
  const ids = meetingTeamIds(opts.series, opts.meeting).filter((id) => id !== opts.actorUserId);
  if (ids.length === 0) return 0;

  const { data: profs } = await supabase
    .from("profiles")
    .select("email")
    .in("user_id", ids);
  const emails = [...new Set((profs ?? []).map((p) => p.email?.trim()).filter(Boolean))] as string[];
  if (emails.length === 0) return 0;

  const label = opts.series?.title ?? opts.meeting.title ?? "Junta";
  const day = opts.meeting.scheduled_at.slice(0, 10);
  const link = `${window.location.origin}/juntas/${opts.meeting.id}/minuta`;
  const html =
    `<p>Resumen de la junta <strong>${escapeHtml(label)}</strong> (${day}).</p>` +
    minutesToHtml(opts.contentMd) +
    `<p><a href="${link}">Abrir la minuta en Kawiil OS</a></p>`;

  try {
    const { data, error } = await supabase.functions.invoke("microsoft-api", {
      body: {
        action: "send-email",
        params: {
          message: {
            subject: `Resumen de junta: ${label} (${day})`,
            body: { contentType: "HTML", content: html },
            toRecipients: emails.map((address) => ({ emailAddress: { address } })),
          },
        },
      },
    });
    if (error || data?.error) throw new Error(error?.message ?? String(data?.error));
    return emails.length;
  } catch (e) {
    console.warn("[mtg] email team", e);
    return 0;
  }
}
