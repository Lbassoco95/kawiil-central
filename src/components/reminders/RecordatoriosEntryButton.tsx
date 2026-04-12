import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REMINDER_AI_PROMPT_ES } from "@/lib/reminderAiPrompt";

export function RecordatoriosEntryButton() {
  const navigate = useNavigate();

  const openRemindersTab = () => {
    navigate("/?tab=recordatorios");
  };

  const openAssistantForReminder = () => {
    navigate(`/asistente?prompt=${encodeURIComponent(REMINDER_AI_PROMPT_ES)}`);
  };

  return (
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
        <DropdownMenuItem onSelect={openAssistantForReminder} className="cursor-pointer">
          <Sparkles className="mr-2 h-4 w-4 shrink-0 text-primary" />
          Pedir a la IA que me recuerde…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
