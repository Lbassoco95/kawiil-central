import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { invokeSlackApi } from "@/lib/slackApi";
import { fetchAllSlackWorkspaceUsers } from "@/lib/slackWorkspaceFetch";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | undefined;
  slackSelfUserId: string | null | undefined;
  onChannelReady: (channelId: string) => void;
};

export function SlackNewDmDialog({
  open,
  onOpenChange,
  connectionId,
  slackSelfUserId,
  onChannelReady,
}: Props) {
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["slack-workspace-users", connectionId],
    queryFn: fetchAllSlackWorkspaceUsers,
    enabled: open && !!connectionId,
    staleTime: 600_000,
  });

  const visibleUsers = useMemo(() => {
    if (!slackSelfUserId) return users;
    return users.filter((u) => u.id !== slackSelfUserId);
  }, [users, slackSelfUserId]);

  const openDm = useMutation({
    mutationFn: async (slackUserId: string) => {
      const data = await invokeSlackApi<{
        ok: boolean;
        error?: string;
        channel?: { id?: string };
        warning?: string;
      }>({
        action: "conversations.open",
        users: slackUserId,
      });
      if (!data.ok || !data.channel?.id) {
        throw new Error(data.error || "No se pudo abrir la conversación");
      }
      return data.channel.id;
    },
    onSuccess: (channelId) => {
      qc.invalidateQueries({ queryKey: ["slack-conversations", connectionId] });
      onChannelReady(channelId);
      onOpenChange(false);
      toast.success("Conversación lista");
    },
    onError: (e: Error) => {
      const msg = e.message || "";
      if (
        msg.includes("missing_scope") ||
        msg.includes("not_allowed_token") ||
        msg.includes("invalid_scope")
      ) {
        toast.error(
          "Slack no autorizó abrir DMs con tu sesión actual. Un admin debe añadir en api.slack.com → tu app → OAuth & Permissions → User Token Scopes: im:write y mpim:write. Luego pulsa «Actualizar permisos Slack» en la barra lateral y acepta de nuevo. Si en Supabase existe el secret SLACK_USER_SCOPES, debe incluir esos scopes o elimínalo para usar los predeterminados.",
          { duration: 18_000 },
        );
      } else {
        toast.error(msg);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 gap-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4 pb-2 space-y-1">
          <DialogTitle>Nuevo mensaje directo</DialogTitle>
          <DialogDescription>
            Elige una persona del workspace. Si ves error de permisos, el administrador de la app Slack debe añadir{" "}
            <span className="font-mono text-[11px]">im:write</span> y{" "}
            <span className="font-mono text-[11px]">mpim:write</span> en User Token Scopes; después usa «Actualizar
            permisos Slack» en la barra lateral.
          </DialogDescription>
        </DialogHeader>
        <Command className="rounded-none border-0 shadow-none [&_[cmdk-input-wrapper]]:border-t">
          <CommandInput placeholder="Buscar por nombre o @usuario…" disabled={openDm.isPending} />
          <CommandList>
            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando personas del workspace…
              </div>
            )}
            {!isLoading && <CommandEmpty>No hay coincidencias.</CommandEmpty>}
            {!isLoading && visibleUsers.length > 0 && (
              <CommandGroup heading="Workspace">
                {visibleUsers.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`${u.label} ${u.subtitle ?? ""} ${u.id}`}
                    disabled={openDm.isPending}
                    onSelect={() => {
                      if (openDm.isPending) return;
                      openDm.mutate(u.id);
                    }}
                  >
                    <span className="truncate">{u.label}</span>
                    {u.subtitle ? (
                      <span className="ml-2 text-xs text-muted-foreground truncate">{u.subtitle}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
