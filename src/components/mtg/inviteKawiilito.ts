/**
 * «Invitar Kawiilito»: explica qué hay conectado para capturar la junta.
 *
 * El cerebro de Hetzner (openclaw) NO entra a la reunión: sirve para la minuta
 * cuando ya hay audio/transcripción. Bot que se une = roadmap.
 */

import { toast } from "sonner";
import type { MtgMeetingRow } from "@/lib/mtg/db";
import { assessKawiilitoCapabilities } from "@/lib/mtg/kawiilitoCapabilities";

export function inviteKawiilito(meeting: MtgMeetingRow, onPasteLink: () => void): void {
  const joinUrl = meeting.teams_join_url;
  const cap = assessKawiilitoCapabilities({
    status: meeting.status,
    teamsJoinUrl: joinUrl,
    teamsOnlineMeetingId: meeting.teams_online_meeting_id,
  });
  const detail = cap.lines.join(" ");
  if (!cap.meetingReady) {
    toast.message(detail, { duration: 10000 });
    return;
  }
  if (!cap.hasJoinUrl) {
    toast.message(detail, { duration: 10000 });
    onPasteLink();
    return;
  }
  toast.message(detail, {
    duration: 14000,
    description:
      "Mientras no haya bot join: Unirse a Teams (graba ahí) o «Audio de llamada» en este tablero → Storage → Whisper → minuta (cerebro Hetzner).",
  });
  if (joinUrl) window.open(joinUrl, "_blank", "noopener,noreferrer");
}
