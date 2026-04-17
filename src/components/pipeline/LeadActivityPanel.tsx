import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, Mail, MessageCircle, Calendar, StickyNote, CheckSquare } from "lucide-react";
import { LogCallModal } from "./modals/LogCallModal";
import { AddNoteModal } from "./modals/AddNoteModal";
import { LogWhatsAppModal } from "./modals/LogWhatsAppModal";
import { ScheduleMeetingModal } from "./modals/ScheduleMeetingModal";
import { SendEmailModal } from "./modals/SendEmailModal";
import { CreateTaskModal } from "./modals/CreateTaskModal";

interface Props {
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  currentStageId: string;
}

const actions = [
  { key: "call", label: "Llamada", icon: Phone, color: "text-green-600 hover:bg-green-50 border-green-200" },
  { key: "email", label: "Email", icon: Mail, color: "text-blue-600 hover:bg-blue-50 border-blue-200" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "text-emerald-600 hover:bg-emerald-50 border-emerald-200" },
  { key: "meeting", label: "Reunión", icon: Calendar, color: "text-purple-600 hover:bg-purple-50 border-purple-200" },
  { key: "note", label: "Nota", icon: StickyNote, color: "text-amber-600 hover:bg-amber-50 border-amber-200" },
  { key: "task", label: "Tarea", icon: CheckSquare, color: "text-slate-600 hover:bg-slate-50 border-slate-200" },
] as const;

type ModalKey = (typeof actions)[number]["key"];

export function LeadActivityPanel({ leadId, leadName, leadEmail, currentStageId }: Props) {
  const [openModal, setOpenModal] = useState<ModalKey | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Button
              key={a.key}
              variant="outline"
              size="sm"
              className={a.color}
              onClick={() => setOpenModal(a.key)}
            >
              <Icon className="h-4 w-4 mr-1" />
              {a.label}
            </Button>
          );
        })}
      </div>

      <LogCallModal
        open={openModal === "call"}
        onOpenChange={(v) => !v && setOpenModal(null)}
        leadId={leadId}
        leadName={leadName}
        currentStageId={currentStageId}
      />
      <SendEmailModal
        open={openModal === "email"}
        onClose={() => setOpenModal(null)}
        leadId={leadId}
        leadName={leadName}
        leadEmail={leadEmail || ""}
      />
      <LogWhatsAppModal
        open={openModal === "whatsapp"}
        onOpenChange={(v) => !v && setOpenModal(null)}
        leadId={leadId}
        leadName={leadName}
      />
      <ScheduleMeetingModal
        open={openModal === "meeting"}
        onOpenChange={(v) => !v && setOpenModal(null)}
        leadId={leadId}
        leadName={leadName}
      />
      <AddNoteModal
        open={openModal === "note"}
        onOpenChange={(v) => !v && setOpenModal(null)}
        leadId={leadId}
      />
      <CreateTaskModal
        open={openModal === "task"}
        onOpenChange={(v) => !v && setOpenModal(null)}
        leadId={leadId}
        leadName={leadName}
      />
    </>
  );
}
