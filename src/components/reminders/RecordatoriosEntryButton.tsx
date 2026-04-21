import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useReminders } from "@/hooks/useReminders";
import { ReminderCreateDialog } from "@/components/reminders/ReminderCreateDialog";

export function RecordatoriosEntryButton() {
  const navigate = useNavigate();
  const { addReminder } = useReminders();
  const [createOpen, setCreateOpen] = useState(false);

  const openRemindersTab = () => {
    navigate("/?tab=recordatorios");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Bell className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[9rem] sm:max-w-none">Recordatorios</span>
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[min(100vw-2rem,260px)]">
          <DropdownMenuItem onSelect={openRemindersTab} className="cursor-pointer">
            <Bell className="mr-2 h-4 w-4 shrink-0" />
            Abrir recordatorios
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              // Evitar conflicto de foco entre DropdownMenu y Dialog (Radix): abrir en el siguiente tick.
              queueMicrotask(() => setCreateOpen(true));
            }}
            className="cursor-pointer"
          >
            <Plus className="mr-2 h-4 w-4 shrink-0 text-primary" />
            Crear recordatorio…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReminderCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(input) => {
          addReminder.mutate(input, { onSuccess: () => setCreateOpen(false) });
        }}
        isPending={addReminder.isPending}
      />
    </>
  );
}
