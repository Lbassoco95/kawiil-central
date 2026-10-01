/**
 * Barra de captura remota: unirse a Teams / pegar link / Kawiilito.
 * Kawiilito entra a una reunión YA creada; la grabación queda en Teams
 * y luego se extrae a la junta.
 */

import { Button } from "@/components/ui/button";
import { ExternalLink, Link2, Bot } from "lucide-react";
import { toast } from "sonner";
import type { MtgMeetingRow } from "@/lib/mtg/db";

export function MtgCallCaptureBar(props: {
  meeting: MtgMeetingRow;
  onPasteLink: () => void;
}) {
  const joinUrl = props.meeting.teams_join_url;
  const meetingReady = props.meeting.status === "planned" || props.meeting.status === "in_progress";

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">
          Teams · esta junta ya existe
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
          onClick={() => {
            if (!meetingReady) {
              toast.message(
                "Esta junta debe estar programada o en curso para que Kawiilito entre a grabar.",
                { duration: 8000 },
              );
              return;
            }
            if (!joinUrl) {
              toast.message(
                "Pega el link de Teams de esta reunión. Kawiilito entra a grabar ahí; la grabación queda en Teams y luego la extraemos.",
                { duration: 9000 },
              );
              props.onPasteLink();
              return;
            }
            toast.message(
              "Kawiilito entrará a esta reunión de Teams a grabar (roadmap). La grabación queda en Teams; después la extraemos a la junta. Mientras: Unirse a Teams o «Audio de llamada» en este tablero.",
              { duration: 11000 },
            );
          }}
          title="Bot que entra a la reunión de Teams ya creada para grabar"
        >
          <Bot className="h-3.5 w-3.5 mr-1" />
          Invitar Kawiilito
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {joinUrl
          ? "Link listo: graba en Teams (o con Kawiilito) y extraemos audio/transcripción después."
          : "Sin link aún: pégalo para unirte y para que Kawiilito sepa a qué reunión entrar."}
      </p>
    </div>
  );
}
