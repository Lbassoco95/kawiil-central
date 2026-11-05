import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Copy, Check, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { formatMX } from "@/lib/dateUtils";
import { useActivity } from "@/hooks/useActivities";

/** Mensaje base para los invitados con los datos reales de la actividad. */
function buildInviteMessage(a: { name: string; event_date: string | null; location: string | null }): string {
  const fecha = a.event_date ? formatMX(a.event_date, "EEEE d 'de' MMMM 'de' yyyy") : "";
  const lines = [
    "¡Hola! 👋",
    "",
    `Te esperamos en ${a.name}.`,
    "",
    `📅 Fecha: ${fecha || "por confirmar"}`,
    `📍 Lugar: ${a.location?.trim() || "por confirmar"}`,
    "",
    "El evento es +1: puedes venir con un acompañante.",
    "Por favor confírmanos tu asistencia, el nombre de tu acompañante y si tú o tu acompañante tienen alguna restricción alimentaria.",
    "",
    "¡Gracias!",
  ];
  return lines.join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function InviteMessageDialog({ activityId }: { activityId: string }) {
  const { data: activity } = useActivity(activityId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  // Se regenera al abrir, para tomar la sede y fecha vigentes.
  useEffect(() => {
    if (open && activity) { setText(buildInviteMessage(activity)); setCopied(false); }
  }, [open, activity]);

  const missingVenue = !activity?.location?.trim();
  const missingDate = !activity?.event_date;

  const handleCopy = async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      toast.success("Mensaje copiado. Pégalo en WhatsApp, correo o Slack.");
    } else {
      toast.error("No se pudo copiar. Selecciona el texto y cópialo manualmente.");
    }
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
        {(missingVenue || missingDate) && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {missingVenue && missingDate
              ? "Aún no hay fecha ni sede definidas: el mensaje dirá “por confirmar”."
              : missingVenue
                ? "Aún no hay sede confirmada: el mensaje dirá “por confirmar”. Confírmala en Pendientes → Casas / Sede."
                : "Aún no hay fecha definida: el mensaje dirá “por confirmar”."}
          </p>
        )}
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button onClick={handleCopy} disabled={!text.trim()}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copiado" : "Copiar mensaje"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
