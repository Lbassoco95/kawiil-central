import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Copy, Check, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";
import { formatMX } from "@/lib/dateUtils";
import { useActivity } from "@/hooks/useActivities";

/** Mensaje base para los invitados con los datos reales de la actividad. */
function buildInviteMessage(a: {
  name: string; event_date: string | null; event_time: string | null; location: string | null;
}): string {
  const fecha = a.event_date ? formatMX(a.event_date, "EEEE d 'de' MMMM 'de' yyyy") : "";
  const lines = [
    "¡Hola! 👋",
    "",
    `Te esperamos en ${a.name}.`,
    "",
    `📅 Fecha: ${fecha || "por confirmar"}`,
    `🕒 Hora: ${a.event_time ? `${a.event_time.slice(0, 5)} h` : "por confirmar"}`,
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

  // Abre WhatsApp (app o web) con el texto listo; ahí se elige a quién enviarlo.
  const handleWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) toast.error("El navegador bloqueó la ventana. Permite ventanas emergentes o usa Copiar mensaje.");
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
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button variant="outline" onClick={handleWhatsApp} disabled={!text.trim()}>
            <Send className="mr-1.5 h-4 w-4" />
            Enviar por WhatsApp
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
