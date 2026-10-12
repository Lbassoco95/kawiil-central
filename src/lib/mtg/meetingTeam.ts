/**
 * Equipo interno de la junta: quién recibe el resumen (minuta) y los avisos.
 * Se guarda en `mtg_series.attendees_internal` (ya usado por recordatorios y minuta).
 */

import { mtgDb, type MtgMeetingRow, type MtgSeriesRow } from "@/lib/mtg/db";
import { supabase } from "@/integrations/supabase/client";
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
  meeting: Pick<MtgMeetingRow, "id" | "scheduled_at" | "title">;
  series: Pick<MtgSeriesRow, "owner_user_id" | "attendees_internal" | "title"> | null;
  contentMd: string;
}): Promise<number> {
  const ids = meetingTeamIds(opts.series).filter((id) => id !== opts.actorUserId);
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
    `<div style="white-space:pre-wrap;font-family:inherit">${escapeHtml(opts.contentMd)}</div>` +
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
