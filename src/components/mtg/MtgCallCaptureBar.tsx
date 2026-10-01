/**
 * Barra de captura remota: unirse a Teams / pegar link / Kawiilito (roadmap).
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

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
      <span className="text-xs text-muted-foreground mr-1">
        Llamada Microsoft / captura
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
          Pegar link de llamada
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
          if (!joinUrl) {
            toast.message("Primero pega el link de Teams; luego podrás invitar a Kawiilito.", {
              duration: 7000,
            });
            props.onPasteLink();
            return;
          }
          toast.message(
            "Kawiilito (bot que entra a grabar) está en roadmap. Mientras: Unirse a Teams y usa «Audio de llamada» / «Grabar audio» en este tablero.",
            { duration: 10000 },
          );
        }}
        title="Bot que se une a la reunión para grabar (próximamente)"
      >
        <Bot className="h-3.5 w-3.5 mr-1" />
        Invitar Kawiilito
      </Button>
    </div>
  );
}
