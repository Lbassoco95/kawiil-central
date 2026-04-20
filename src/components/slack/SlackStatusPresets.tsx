import { useMutation } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { invokeSlackApi, isSlackPermissionDeniedMessage, SLACK_CHAT_API_PERMISSION_HINT, SLACK_PERMISSION_TOAST_MS } from "@/lib/slackApi";
import { Smile, Loader2 } from "lucide-react";
import { toast } from "sonner";

function endOfLocalDayUnix(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return Math.floor(d.getTime() / 1000);
}

const PRESETS: { label: string; emoji: string; text: string }[] = [
  { label: "Home office", emoji: ":house:", text: "En home office" },
  { label: "Comisión", emoji: ":briefcase:", text: "En comisión" },
  { label: "Fuera de la oficina", emoji: ":walking:", text: "Fuera de la oficina" },
  { label: "Día personal", emoji: ":palm_tree:", text: "Día personal" },
];

export function SlackStatusPresets() {
  const setStatus = useMutation({
    mutationFn: async (preset: (typeof PRESETS)[number] | null) => {
      if (preset === null) {
        const data = await invokeSlackApi<{ ok?: boolean; error?: string }>({
          action: "users.profile.set",
          clear_status: true,
        });
        if (!data.ok) throw new Error(data.error || "No se pudo limpiar el estado");
        return;
      }
      const data = await invokeSlackApi<{ ok?: boolean; error?: string }>({
        action: "users.profile.set",
        profile: {
          status_text: preset.text,
          status_emoji: preset.emoji,
          status_expiration: endOfLocalDayUnix(),
        },
      });
      if (!data.ok) throw new Error(data.error || "No se pudo actualizar el estado");
    },
    onSuccess: (_, preset) => {
      toast.success(preset ? `Estado en Slack: ${preset.text}` : "Estado de Slack eliminado");
    },
    onError: (e: Error) => {
      const msg = e.message || "";
      if (isSlackPermissionDeniedMessage(msg)) {
        toast.error(
          `${SLACK_CHAT_API_PERMISSION_HINT} Añade además users.profile:write en User Token Scopes.`,
          { duration: SLACK_PERMISSION_TOAST_MS },
        );
        return;
      }
      toast.error(msg);
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs justify-start gap-2 bg-background/60 border-border hover:bg-accent/60"
          disabled={setStatus.isPending}
        >
          {setStatus.isPending ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Smile className="h-3.5 w-3.5 shrink-0 opacity-80" />
          )}
          Estado en Slack
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {PRESETS.map((p) => (
          <DropdownMenuItem key={p.label} onClick={() => setStatus.mutate(p)} className="text-sm">
            {p.label}
            <span className="ml-auto text-[10px] text-muted-foreground font-normal">{p.text}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setStatus.mutate(null)} className="text-sm text-muted-foreground">
          Quitar estado
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
