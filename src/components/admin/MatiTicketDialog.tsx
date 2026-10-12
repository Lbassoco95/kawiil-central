import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  ESTADOS_TICKET,
  PRIORIDADES_TICKET,
  useMatiTicketMessage,
  useMatiTicketUpdate,
  type EstadoTicket,
  type MatiRow,
  type PrioridadTicket,
} from "@/hooks/useMatiGateway";

const MAX_MESSAGE = 5000;
const NO_CHANGE = "__sin_cambio__";

type Pending =
  | { kind: "update"; estado?: EstadoTicket; prioridad?: PrioridadTicket }
  | { kind: "message"; mensaje: string };

const label = (v: string) => v.replace(/_/g, " ");

/**
 * Gestión de un ticket de MATI desde Kawiil. Cada cambio pide una confirmación
 * explícita que muestra exactamente qué se enviará y a quién le llega.
 * Los textos no se guardan: el estado del diálogo se borra al cerrarlo.
 */
export function MatiTicketDialog({
  ticket,
  onClose,
}: {
  ticket: MatiRow | null;
  onClose: () => void;
}) {
  const update = useMatiTicketUpdate();
  const message = useMatiTicketMessage();
  const [estado, setEstado] = useState<string>(NO_CHANGE);
  const [prioridad, setPrioridad] = useState<string>(NO_CHANGE);
  const [mensaje, setMensaje] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  const id = ticket ? String(ticket.id ?? "") : "";
  const asunto = ticket ? String(ticket.asunto ?? ticket.titulo ?? "Sin asunto") : "";
  const busy = update.isPending || message.isPending;

  const close = () => {
    if (busy) return;
    setEstado(NO_CHANGE);
    setPrioridad(NO_CHANGE);
    setMensaje("");
    setPending(null);
    onClose();
  };

  const trimmed = mensaje.trim();
  const canReviewUpdate = estado !== NO_CHANGE || prioridad !== NO_CHANGE;
  const canReviewMessage = trimmed.length > 0 && trimmed.length <= MAX_MESSAGE;

  const confirm = async () => {
    if (!pending || !id) return;
    try {
      if (pending.kind === "update") {
        await update.mutateAsync({ id, estado: pending.estado, prioridad: pending.prioridad });
        toast.success("Ticket actualizado en MATI");
      } else {
        await message.mutateAsync({ id, mensaje: pending.mensaje });
        toast.success("Mensaje enviado en MATI");
      }
      setPending(null);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo completar el cambio");
      setPending(null);
    }
  };

  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Gestionar ticket de MATI</DialogTitle>
          <DialogDescription className="line-clamp-2 text-xs">{asunto}</DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="space-y-3 text-sm" data-testid="mati-confirm">
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Este cambio se aplica <strong>en MATI</strong> y queda registrado con tu usuario. Revísalo antes de confirmar.
              </p>
            </div>
            {pending.kind === "update" ? (
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {pending.estado && (
                  <li>
                    Estado: <strong>{label(String(ticket?.estado ?? "—"))}</strong> → <strong>{label(pending.estado)}</strong>
                  </li>
                )}
                {pending.prioridad && (
                  <li>
                    Prioridad: <strong>{label(String(ticket?.prioridad ?? "—"))}</strong> → <strong>{label(pending.prioridad)}</strong>
                  </li>
                )}
              </ul>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Quien abrió el ticket verá este mensaje:</p>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs">
                  {pending.mensaje}
                </p>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setPending(null)} disabled={busy}>
                Volver
              </Button>
              <Button size="sm" onClick={() => void confirm()} disabled={busy}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Confirmar y enviar a MATI
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <h4 className="text-xs font-semibold">Estado y prioridad</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Estado</Label>
                  <Select value={estado} onValueChange={setEstado}>
                    <SelectTrigger className="h-8 text-xs" aria-label="Estado">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CHANGE}>Sin cambio</SelectItem>
                      {ESTADOS_TICKET.map((v) => (
                        <SelectItem key={v} value={v}>{label(v)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Prioridad</Label>
                  <Select value={prioridad} onValueChange={setPrioridad}>
                    <SelectTrigger className="h-8 text-xs" aria-label="Prioridad">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CHANGE}>Sin cambio</SelectItem>
                      {PRIORIDADES_TICKET.map((v) => (
                        <SelectItem key={v} value={v}>{label(v)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={!canReviewUpdate}
                onClick={() =>
                  setPending({
                    kind: "update",
                    estado: estado === NO_CHANGE ? undefined : (estado as EstadoTicket),
                    prioridad: prioridad === NO_CHANGE ? undefined : (prioridad as PrioridadTicket),
                  })
                }
              >
                Revisar cambio
              </Button>
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold">Responder al ticket</h4>
              <Textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                placeholder="Escribe el mensaje que verá quien abrió el ticket"
                rows={4}
                maxLength={MAX_MESSAGE}
                className="text-xs"
                aria-label="Mensaje"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {trimmed.length}/{MAX_MESSAGE}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={!canReviewMessage}
                  onClick={() => setPending({ kind: "message", mensaje: trimmed })}
                >
                  Revisar mensaje
                </Button>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
