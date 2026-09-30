/**
 * Desde /juntas: elegir entre invitar con un link de llamada
 * ya en curso, o generar una junta nueva (Outlook/Teams).
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link2, Video } from "lucide-react";

export type MtgMeetingEntryMode = "join_link" | "create";

export function MtgMeetingEntryChooser(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nombre del cliente si ya se eligió; null = sin cliente. */
  clientName?: string | null;
  onChoose: (mode: MtgMeetingEntryMode) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Cómo quieres la reunión?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {props.clientName
            ? `Junta de ${props.clientName}. Elige si ya hay una llamada en curso o si quieres generar una nueva.`
            : "Elige si ya estás en una llamada (o te pasaron el enlace) o si quieres generar una junta nueva para ingresar."}
        </p>
        <div className="grid gap-3 pt-1">
          <button
            type="button"
            className="flex items-start gap-3 rounded-lg border border-border/70 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 hover:border-sky-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              props.onOpenChange(false);
              props.onChoose("join_link");
            }}
          >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-400">
              <Link2 className="h-4 w-4" />
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block font-medium text-foreground">
                Invitar con un link
              </span>
              <span className="block text-xs text-muted-foreground">
                Pega el enlace de Teams, Meet o Zoom de una llamada ya en curso
                (o que te compartieron) para asociarlo a la junta e ingresar.
              </span>
            </span>
          </button>
          <button
            type="button"
            className="flex items-start gap-3 rounded-lg border border-border/70 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              props.onOpenChange(false);
              props.onChoose("create");
            }}
          >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Video className="h-4 w-4" />
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block font-medium text-foreground">
                Generar nueva junta
              </span>
              <span className="block text-xs text-muted-foreground">
                Crea la junta en Múuch' y, si quieres, el evento en Outlook con
                reunión de Teams para que todos puedan ingresar.
              </span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
