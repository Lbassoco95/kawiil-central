import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Link2, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";
import { formatMX } from "@/lib/dateUtils";
import { copyText } from "@/lib/clipboard";
import { useActivity } from "@/hooks/useActivities";
import { useActivityAttendees } from "@/hooks/useActivityExtras";
import { inviteeMessage, rsvpUrl, type InviteFields } from "@/lib/activityInviteMessage";
import { normalizeWhatsappNumber, whatsappUrl, personalizeGreeting, firstName } from "@/lib/whatsapp";

type ActivityInfo = {
  name: string; event_date: string | null; event_time: string | null; location: string | null;
};

const toFields = (a: ActivityInfo): InviteFields => ({
  name: a.name,
  fecha: a.event_date ? formatMX(a.event_date, "EEEE d 'de' MMMM 'de' yyyy") : "",
  hora: a.event_time,
  lugar: a.location,
});

export function InviteMessageDialog({ activityId }: { activityId: string }) {
  const { data: activity } = useActivity(activityId);
  const { data: attendees } = useActivityAttendees(activityId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  // Se regenera al abrir, para tomar la sede y fecha vigentes.
  useEffect(() => {
    if (open && activity) { setText(inviteeMessage(toFields(activity))); }
  }, [open, activity]);

  const missingVenue = !activity?.location?.trim();
  const faltantes = [
    missingVenue && "la sede",
    !activity?.event_date && "la fecha",
    !activity?.event_time && "la hora",
  ].filter((x): x is string => !!x);

  const openWhatsApp = (url: string) => {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) toast.error("El navegador bloqueó la ventana. Permite ventanas emergentes o usa Copiar mensaje.");
  };

  // Destinatarios: cada invitado (que no haya dicho que no) con su enlace personal.
  // El +1 ya no recibe mensaje propio: su invitado lo registra en la página y el equipo lo aprueba.
  type Recipient = { key: string; label: string; person: string; phone: string | null; token: string };
  const recipients: Recipient[] = (attendees ?? [])
    .filter((a) => a.confirmed !== "no")
    .map((a) => ({
      key: a.id, label: firstName(a.name) || a.name, person: a.name, phone: a.phone, token: a.rsvp_token,
    }));
  const withoutPhone = recipients.filter((r) => !normalizeWhatsappNumber(r.phone));

  const linkFor = (r: Recipient) => rsvpUrl(window.location.origin, r.token);
  // Mensaje personal: el texto del cuadro (editable) con el enlace del invitado al final.
  const bodyFor = (r: Recipient) => `${text.trimEnd()}\n\n${linkFor(r)}`;

  const sendTo = (r: Recipient, number: string) =>
    openWhatsApp(whatsappUrl(personalizeGreeting(bodyFor(r), r.person), number));

  const copyLink = async (r: Recipient) => {
    const ok = await copyText(linkFor(r));
    if (ok) toast.success(`Enlace de ${r.label} copiado.`);
    else toast.error("No se pudo copiar. Inténtalo de nuevo.");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />
          Mensaje a invitados
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mensaje para los invitados</DialogTitle>
          <DialogDescription>
            Toma la fecha y la sede de la actividad. Puedes editarlo antes de enviarlo; el enlace personal se agrega solo.
          </DialogDescription>
        </DialogHeader>
        {faltantes.length > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Falta definir {faltantes.join(", ").replace(/, ([^,]*)$/, " y $1")}: el mensaje dirá “por confirmar”.
            {missingVenue && " La sede se confirma en Pendientes → Casas / Sede."}
            {(!activity?.event_date || !activity?.event_time) && " La fecha y la hora se editan en Editar actividad."}
          </p>
        )}
        {!missingVenue && !activity?.venue_confirmed && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            La sede todavía no está marcada como confirmada. Confírmala en Detalles → “Confirmar sede” antes de avisar a los invitados.
          </p>
        )}
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="space-y-2">
          <p className="text-sm font-medium">Enviar a cada invitado</p>
          <p className="text-xs text-muted-foreground">
            Cada quien recibe este mensaje con su enlace personal. En la página confirma si va, si es alérgico a algo
            y puede pedir un acompañante (+1); la solicitud te aparece en Asistentes para aprobarla.
          </p>
          {recipients.length === 0 && (
            <p className="text-xs text-muted-foreground">Agrega asistentes para generar sus enlaces.</p>
          )}
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {recipients.map((r) => {
              const number = normalizeWhatsappNumber(r.phone);
              return (
                <div key={r.key} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                  <span className="truncate text-sm">{r.label}</span>
                  <div className="flex shrink-0 gap-1.5">
                    {number ? (
                      <Button type="button" size="sm" variant="outline" className="h-8" disabled={!text.trim()}
                        onClick={() => sendTo(r, number)}>
                        <Send className="mr-1.5 h-3 w-3" />WhatsApp
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => copyLink(r)}>
                      <Link2 className="mr-1.5 h-3 w-3" />Copiar enlace
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {withoutPhone.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Sin teléfono válido: {withoutPhone.map((r) => r.label).join(", ")}. Copia su enlace o agrega el teléfono al editar al asistente.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
