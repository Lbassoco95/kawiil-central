/**
 * Barra de captura remota: unirse a Teams / pegar link / Kawiilito.
 *
 * El cerebro de Hetzner (openclaw) NO entra a la reunión: sirve para la minuta
 * cuando ya hay audio/transcripción. Hoy: grabar en Teams o Audio de llamada;
 * bot que se une = roadmap.
 */

import { Button } from "@/components/ui/button";
import { ExternalLink, Link2, Bot } from "lucide-react";
import { toast } from "sonner";
import type { MtgMeetingRow } from "@/lib/mtg/db";
import { assessKawiilitoCapabilities } from "@/lib/mtg/kawiilitoCapabilities";

export function MtgCallCaptureBar(props: {
  meeting: MtgMeetingRow;
  onPasteLink: () => void;
}) {
  const joinUrl = props.meeting.teams_join_url;
  const cap = assessKawiilitoCapabilities({
    status: props.meeting.status,
    teamsJoinUrl: props.meeting.teams_join_url,
    teamsOnlineMeetingId: props.meeting.teams_online_meeting_id,
  });

  const onInviteKawiilito = () => {
    const detail = cap.lines.join(" ");
    if (!cap.meetingReady) {
      toast.message(detail, { duration: 10000 });
      return;
    }
    if (!cap.hasJoinUrl) {
      toast.message(detail, { duration: 10000 });
      props.onPasteLink();
      return;
    }
    toast.message(detail, {
      duration: 14000,
      description:
        "Mientras no haya bot join: Unirse a Teams (graba ahí) o «Audio de llamada» en este tablero → Storage → Whisper → minuta (cerebro Hetzner).",
    });
    if (joinUrl) {
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">
          Teams · captura (cerebro Hetzner = minutas, no el bot)
        </span>
        {joinUrl ? (
          <Button asChild size="sm" variant="default">
            <a href={joinUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Unirse a Teams
            </a>
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={props.onPasteLink}>
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Pegar link de la reunión
          </Button>
        )}
        {joinUrl && (
          <Button type="button" size="sm" variant="ghost" onClick={props.onPasteLink}>
            <Link2 className="h-3.5 w-3.5 mr-1" />
            Cambiar link
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onInviteKawiilito}
          title="Qué hay conectado para capturar (Hetzner / Teams / browser)"
        >
          <Bot className="h-3.5 w-3.5 mr-1" />
          Invitar Kawiilito
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {joinUrl
          ? "Link listo: graba en Teams o con Audio de llamada → queda en Storage; el cerebro de Hetzner arma la minuta después. Bot que entra solo = roadmap."
          : "Sin link: pégalo. Kawiilito-join y extracción Graph automática aún no están conectados; sí lo están grabación en browser + Whisper + openclaw para minuta."}
      </p>
    </div>
  );
}
