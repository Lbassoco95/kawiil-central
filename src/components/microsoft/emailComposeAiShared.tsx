import type { LucideIcon } from "lucide-react";
import { CalendarCheck, Mail as MailIcon, FileSpreadsheet, HandCoins } from "lucide-react";

export type ImproveMode = "improve" | "shorter" | "formal" | "friendly";

export const QUICK_DRAFT_TEMPLATES: Array<{
  id: string;
  label: string;
  icon: LucideIcon;
  instruction: string;
}> = [
  {
    id: "confirm-meeting",
    label: "Confirmar reunión",
    icon: CalendarCheck,
    instruction:
      "Redacta un correo breve y cordial para confirmar la reunión propuesta. Incluye fecha, hora y un cierre amable.",
  },
  {
    id: "request-info",
    label: "Pedir información",
    icon: MailIcon,
    instruction:
      "Redacta un correo profesional pidiendo la información o documentación pendiente al destinatario, con tono cordial y un cierre claro.",
  },
  {
    id: "send-report",
    label: "Enviar reporte semanal",
    icon: FileSpreadsheet,
    instruction:
      "Redacta un correo presentando el reporte semanal adjunto: resume 2-3 hitos del avance y cierra con un próximo paso.",
  },
  {
    id: "follow-up-payment",
    label: "Seguimiento de pago",
    icon: HandCoins,
    instruction:
      "Redacta un correo cordial para dar seguimiento al pago de una factura pendiente, agradeciendo de antemano y ofreciendo apoyo si necesitan algo.",
  },
];

export function plainTextToEmailHtml(text: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const t = text.trim();
  if (!t) return "<p></p>";
  const blocks = t.split(/\n\n+/);
  return blocks.map((b) => `<p>${esc(b).replace(/\n/g, "<br/>")}</p>`).join("");
}
