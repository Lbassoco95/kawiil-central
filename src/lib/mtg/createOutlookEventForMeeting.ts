/**
 * Crea un evento Outlook + reunión Teams para una junta Múuch'
 * y mapea la respuesta Graph a columnas de mtg_meetings.
 */

import { addMinutes, format, parse } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { CDMX_TZ } from "@/lib/dateUtils";
import { formatMicrosoftIntegrationError } from "@/lib/microsoftIntegrationErrors";

export type OutlookTeamsMeetingLink = {
  outlook_event_id: string;
  teams_join_url: string | null;
  teams_online_meeting_id: string | null;
  /** Graph creó el evento pero sin Teams (fallback de licencia/tenant). */
  onlineMeetingFallback: boolean;
};

/** datetime-local (`YYYY-MM-DDTHH:mm`) + duración → rango Graph en CDMX. */
export function graphRangeFromDatetimeLocal(
  scheduledLocal: string,
  durationMin: number,
): {
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
} {
  const raw = scheduledLocal.trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) {
    throw new Error("Fecha y hora inválidas para el evento de Outlook.");
  }
  const dateStr = match[1];
  const startTime = match[2];
  const startLocal = parse(`${dateStr} ${startTime}`, "yyyy-MM-dd HH:mm", new Date());
  if (Number.isNaN(startLocal.getTime())) {
    throw new Error("Fecha y hora inválidas para el evento de Outlook.");
  }
  const mins = Number.isFinite(durationMin) && durationMin >= 5 ? durationMin : 60;
  const endLocal = addMinutes(startLocal, mins);
  return {
    start: { dateTime: `${dateStr}T${startTime}:00`, timeZone: CDMX_TZ },
    end: {
      dateTime: `${format(endLocal, "yyyy-MM-dd")}T${format(endLocal, "HH:mm")}:00`,
      timeZone: CDMX_TZ,
    },
  };
}

export function mapGraphEventToMeetingLink(data: unknown): OutlookTeamsMeetingLink {
  const d = (data || {}) as {
    id?: string;
    onlineMeeting?: { joinUrl?: string | null; id?: string | null } | null;
    onlineMeetingUrl?: string | null;
    onlineMeetingFallback?: boolean;
  };
  const outlookId = typeof d.id === "string" ? d.id.trim() : "";
  if (!outlookId) {
    throw new Error("Microsoft no devolvió el id del evento de calendario.");
  }
  const joinUrl =
    (typeof d.onlineMeeting?.joinUrl === "string" && d.onlineMeeting.joinUrl.trim()) ||
    (typeof d.onlineMeetingUrl === "string" && d.onlineMeetingUrl.trim()) ||
    null;
  const onlineId =
    typeof d.onlineMeeting?.id === "string" && d.onlineMeeting.id.trim()
      ? d.onlineMeeting.id.trim()
      : null;
  return {
    outlook_event_id: outlookId,
    teams_join_url: joinUrl,
    teams_online_meeting_id: onlineId,
    onlineMeetingFallback: !!d.onlineMeetingFallback || !joinUrl,
  };
}

export async function createOutlookTeamsEventForMeeting(opts: {
  subject: string;
  /** Valor de `<input type="datetime-local">`. */
  scheduledLocal: string;
  durationMin: number;
  bodyText?: string;
}): Promise<OutlookTeamsMeetingLink> {
  const range = graphRangeFromDatetimeLocal(opts.scheduledLocal, opts.durationMin);
  const { data, error } = await supabase.functions.invoke("microsoft-api", {
    body: {
      action: "create-event",
      params: {
        event: {
          subject: opts.subject.trim() || "Junta",
          start: range.start,
          end: range.end,
          isOnlineMeeting: true,
          onlineMeetingProvider: "teamsForBusiness",
          body: opts.bodyText?.trim()
            ? { contentType: "text", content: opts.bodyText.trim() }
            : {
                contentType: "text",
                content: "Junta creada desde Kawiil · Múuch'",
              },
        },
      },
    },
  });
  if (error) {
    throw new Error(formatMicrosoftIntegrationError(error));
  }
  if (data?.error) {
    throw new Error(formatMicrosoftIntegrationError(new Error(String(data.error))));
  }
  if (data?.code === "NOT_CONNECTED") {
    throw new Error(
      "Conecta Microsoft 365 (calendario) para crear el evento y la reunión de Teams.",
    );
  }
  return mapGraphEventToMeetingLink(data);
}
