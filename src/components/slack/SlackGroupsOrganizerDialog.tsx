import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { SlackConversation } from "@/lib/slackApi";
import { conversationTitle, type ConversationTitleOpts } from "@/components/slack/slackGrouping";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, X } from "lucide-react";
import { toast } from "sonner";

type GroupRow = {
  id: string;
  title: string;
  sort_order: number;
  slack_sidebar_group_channels: { channel_id: string; sort_order: number }[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: SlackConversation[];
  organizationId: string;
  titleOpts?: ConversationTitleOpts;
  userMap: Record<string, SlackUserProfile | undefined>;
};

export function SlackGroupsOrganizerDialog({
  open,
  onOpenChange,
  conversations,
  organizationId,
  titleOpts,
  userMap,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [addToGroupId, setAddToGroupId] = useState<string>("");
  const [addChannelId, setAddChannelId] = useState<string>("");

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["slack-sidebar-groups", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_sidebar_groups")
        .select("id, title, sort_order, slack_sidebar_group_channels(channel_id, sort_order)")
        .eq("user_id", user!.id)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as GroupRow[];
    },
    enabled: open && !!user?.id,
  });

  const channelToGroup = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      for (const ch of g.slack_sidebar_group_channels || []) {
        m.set(ch.channel_id, g.id);
      }
    }
    return m;
  }, [groups]);

  const unassignedConversations = useMemo(
    () => conversations.filter((c) => !channelToGroup.has(c.id)),
    [conversations, channelToGroup],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["slack-sidebar-groups", user?.id] });

  const createGroup = useMutation({
    mutationFn: async (title: string) => {
      const t = title.trim() || "Nuevo grupo";
      const nextOrder = groups.length ? Math.max(...groups.map((g) => g.sort_order)) + 1 : 0;
      const { error } = await supabase.from("slack_sidebar_groups").insert({
        user_id: user!.id,
        organization_id: organizationId,
        title: t,
        sort_order: nextOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setNewGroupTitle("");
      toast.success("Grupo creado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteGroup = useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase.from("slack_sidebar_groups").delete().eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Grupo eliminado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameGroup = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { error } = await supabase.from("slack_sidebar_groups").update({ title: title.trim() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const moveGroupOrder = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: "up" | "down" }) => {
      const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order);
      const idx = sorted.findIndex((g) => g.id === id);
      if (idx < 0) return;
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= sorted.length) return;
      const a = sorted[idx];
      const b = sorted[swap];
      await supabase.from("slack_sidebar_groups").update({ sort_order: b.sort_order }).eq("id", a.id);
      await supabase.from("slack_sidebar_groups").update({ sort_order: a.sort_order }).eq("id", b.id);
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const addChannel = useMutation({
    mutationFn: async ({ groupId, channelId }: { groupId: string; channelId: string }) => {
      const myGroupIds = groups.map((g) => g.id);
      if (myGroupIds.length === 0) throw new Error("Crea un grupo primero");
      await supabase.from("slack_sidebar_group_channels").delete().in("group_id", myGroupIds).eq("channel_id", channelId);
      const g = groups.find((x) => x.id === groupId);
      const ch = g?.slack_sidebar_group_channels || [];
      const nextOrder = ch.length ? Math.max(...ch.map((c) => c.sort_order)) + 1 : 0;
      const { error } = await supabase.from("slack_sidebar_group_channels").insert({
        group_id: groupId,
        channel_id: channelId,
        sort_order: nextOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setAddChannelId("");
      toast.success("Conversación añadida al grupo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeChannel = useMutation({
    mutationFn: async ({ groupId, channelId }: { groupId: string; channelId: string }) => {
      const { error } = await supabase
        .from("slack_sidebar_group_channels")
        .delete()
        .eq("group_id", groupId)
        .eq("channel_id", channelId);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sort_order - b.sort_order),
    [groups],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Grupos de conversaciones</DialogTitle>
          <DialogDescription>
            Organiza canales y DMs en secciones propias. Usa &quot;Kawiil IA&quot; en cada grupo para analizar mensajes
            recientes con el asistente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="new-grp">Nuevo grupo</Label>
              <Input
                id="new-grp"
                value={newGroupTitle}
                onChange={(e) => setNewGroupTitle(e.target.value)}
                placeholder="Ej. Clientes, Interno, Urgentes…"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={createGroup.isPending}
              onClick={() => createGroup.mutate(newGroupTitle)}
            >
              {createGroup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {sortedGroups.map((g, gi) => {
                const chRows = [...(g.slack_sidebar_group_channels || [])].sort((a, b) => a.sort_order - b.sort_order);
                return (
                  <div key={g.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={gi === 0 || moveGroupOrder.isPending}
                        onClick={() => moveGroupOrder.mutate({ id: g.id, direction: "up" })}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        disabled={gi === sortedGroups.length - 1 || moveGroupOrder.isPending}
                        onClick={() => moveGroupOrder.mutate({ id: g.id, direction: "down" })}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Input
                        defaultValue={g.title}
                        key={g.id}
                        className="h-8 text-sm flex-1"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== g.title) renameGroup.mutate({ id: g.id, title: v });
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive shrink-0"
                        onClick={() => deleteGroup.mutate(g.id)}
                        disabled={deleteGroup.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <ul className="text-xs space-y-1 pl-1">
                      {chRows.map((row) => {
                        const c = conversations.find((x) => x.id === row.channel_id);
                        const label = c
                          ? conversationTitle(c, userMap, titleOpts)
                          : row.channel_id;
                        return (
                          <li key={row.channel_id} className="flex items-center justify-between gap-2 py-0.5">
                            <span className="truncate">{label}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => removeChannel.mutate({ groupId: g.id, channelId: row.channel_id })}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </li>
                        );
                      })}
                      {chRows.length === 0 && (
                        <li className="text-muted-foreground italic">Sin conversaciones — añade abajo.</li>
                      )}
                    </ul>
                  </div>
                );
              })}
              {sortedGroups.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Aún no hay grupos. Crea el primero arriba.</p>
              )}
            </div>
          )}

          <div className="space-y-2 pt-2 border-t">
            <Label>Añadir conversación a un grupo</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={addToGroupId} onValueChange={setAddToGroupId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Grupo" />
                </SelectTrigger>
                <SelectContent>
                  {sortedGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={addChannelId} onValueChange={setAddChannelId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Conversación" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {unassignedConversations.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {conversationTitle(c, userMap, titleOpts)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!addToGroupId || !addChannelId || addChannel.isPending}
              onClick={() => addChannel.mutate({ groupId: addToGroupId, channelId: addChannelId })}
            >
              {addChannel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Añadir al grupo"}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
