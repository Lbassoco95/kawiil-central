import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Copy, Check, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";
import { formatMX } from "@/lib/dateUtils";
import { copyText } from "@/lib/clipboard";
import { useActivity } from "@/hooks/useActivities";
import { useActivityAttendees } from "@/hooks/useActivityExtras";
import { inviteeMessage, companionMessage, type InviteFields } from "@/lib/activityInviteMessage";
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
  const [copied, setCopied] = useState(false);

  // Se regenera al abrir, para tomar la sede y fecha vigentes.
  useEffect(() => {
    if (open && activity) { setText(inviteeMessage(toFields(activity))); setCopied(false); }
  }, [open, activity]);

  const missingVenue = !activity?.location?.trim();
  const faltantes = [
    missingVenue && "la sede",
    !activity?.event_date && "la fecha",
    !activity?.event_time && "la hora",
  ].filter((x): x is string => !!x);

  const handleCopy = async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      toast.success("Mensaje copiado. Pégalo en WhatsApp, correo o Slack.");
    } else {
      toast.error("No se pudo copiar. Selecciona el texto y cópialo manualmente.");
    }
  };

  const openWhatsApp = (url: string) => {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) toast.error("El navegador bloqueó la ventana. Permite ventanas emergentes o usa Copiar mensaje.");
  };

  // Sin número: abre WhatsApp con el texto y ahí se elige a quién enviarlo.
  const handleWhatsApp = () => openWhatsApp(whatsappUrl(text));

  // Destinatarios: invitados y sus acompañantes (+1). Quien no asiste no recibe el mensaje,
  // y si el invitado no asiste, su acompañante tampoco.
  type Recipient = {
    key: string; label: string; person: string; phone: string | null; kind: "invitado" | "acompañante";
    inviter?: string;
  };
  const recipients: Recipient[] = (attendees ?? []).flatMap((a) => {
    if (a.confirmed === "no") return [];
    const out: Recipient[] = [
      { key: a.id, label: firstName(a.name) || a.name, person: a.name, phone: a.phone, kind: "invitado" },
    ];
    if (a.has_plus_one && a.plus_one_confirmed !== "no") {
      const nombre = a.plus_one_name?.trim() || `Acompañante de ${firstName(a.name) || a.name}`;
      out.push({
        key: `${a.id}-plus`, label: `${nombre} (+1)`, person: nombre, phone: a.plus_one_phone,
        kind: "acompañante", inviter: firstName(a.name) || a.name,
      });
    }
    return out;
  });
  const withPhone = recipients
    .map((r) => ({ r, number: normalizeWhatsappNumber(r.phone) }))
    .filter((x): x is { r: Recipient; number: string } => !!x.number);
  const withoutPhone = recipients.filter((r) => !normalizeWhatsappNumber(r.phone));

  // Invitado: el texto del cuadro (editable). Acompañante: texto propio que dice quién lo invitó.
  const sendTo = (r: Recipient, number: string) => {
    const body = r.kind === "acompañante" && activity
      ? companionMessage(toFields(activity), r.inviter ?? "")
      : text;
    openWhatsApp(whatsappUrl(personalizeGreeting(body, r.person), number));
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
            Toma la fecha y la sede de la actividad. Puedes editarlo antes de copiarlo.
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
        {recipients.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Enviar directo por WhatsApp</p>
            {withPhone.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {withPhone.map(({ r, number }) => (
                  <Button key={r.key} type="button" size="sm" variant="outline" className="h-8"
                    disabled={r.kind === "invitado" && !text.trim()} onClick={() => sendTo(r, number)}>
                    <Send className="mr-1.5 h-3 w-3" />{r.label}
                  </Button>
                ))}
              </div>
            )}
            {recipients.some((r) => r.kind === "acompañante") && (
              <p className="text-xs text-muted-foreground">
                Los acompañantes (+1) reciben un mensaje propio que dice quién los invitó; el texto de arriba es para los invitados.
              </p>
            )}
            {withoutPhone.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Sin teléfono válido: {withoutPhone.map((r) => r.label).join(", ")}. Agrégalo al editar al asistente.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button variant="outline" onClick={handleWhatsApp} disabled={!text.trim()}>
            <Send className="mr-1.5 h-4 w-4" />
            WhatsApp (elegir contacto)
          </Button>
          <Button onClick={handleCopy} disabled={!text.trim()}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copiado" : "Copiar mensaje"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
