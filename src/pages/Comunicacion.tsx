import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { invokeSlackApi, type SlackConversation, type SlackMessage } from "@/lib/slackApi";
import { Loader2, MessageSquare, Hash, Lock, Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function convLabel(c: SlackConversation): string {
  if (c.name) return c.name;
  if (c.is_im) return c.user ? `Usuario ${c.user.slice(0, 8)}…` : "Mensaje directo";
  if (c.is_mpim) return "Grupo";
  return c.id;
}

export default function Comunicacion() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { isConnected, isLoading: loadingConn, connect, isConnecting, connection } = useSlackConnection();

  const channelFromUrl = searchParams.get("channel") || "";
  const tsFromUrl = searchParams.get("ts") || "";

  const [selectedChannel, setSelectedChannel] = useState<string>(channelFromUrl);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (channelFromUrl) setSelectedChannel(channelFromUrl);
  }, [channelFromUrl]);

  const { data: profile } = useQuery({
    queryKey: ["profile-org-slack", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user && isConnected,
  });

  const conversationsQuery = useQuery({
    queryKey: ["slack-conversations", connection?.id],
    queryFn: async () => {
      const data = await invokeSlackApi<{ ok: boolean; channels?: SlackConversation[]; error?: string }>({
        action: "conversations.list",
        types: "public_channel,private_channel,mpim,im",
        limit: 200,
      });
      if (!data.ok) throw new Error(data.error || "No se pudieron cargar conversaciones");
      return (data.channels || []).filter((c) => c.id);
    },
    enabled: isConnected,
    staleTime: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ["slack-history", selectedChannel],
    queryFn: async () => {
      const data = await invokeSlackApi<{ ok: boolean; messages?: SlackMessage[]; error?: string }>({
        action: "conversations.history",
        channel: selectedChannel,
        limit: 80,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo cargar el historial");
      const list = [...(data.messages || [])].reverse();
      return list;
    },
    enabled: isConnected && !!selectedChannel,
  });

  const { data: isWatching } = useQuery({
    queryKey: ["slack-watch", user?.id, selectedChannel],
    queryFn: async () => {
      const { data } = await supabase
        .from("slack_channel_watches")
        .select("id")
        .eq("user_id", user!.id)
        .eq("channel_id", selectedChannel)
        .maybeSingle();
      return !!data;
    },
    enabled: !!user && !!selectedChannel && isConnected,
  });

  const watchMutation = useMutation({
    mutationFn: async (watch: boolean) => {
      if (!profile?.organization_id || !selectedChannel) return;
      if (watch) {
        const { error } = await supabase.from("slack_channel_watches").upsert(
          {
            user_id: user!.id,
            organization_id: profile.organization_id,
            channel_id: selectedChannel,
          },
          { onConflict: "user_id,channel_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("slack_channel_watches")
          .delete()
          .eq("user_id", user!.id)
          .eq("channel_id", selectedChannel);
        if (error) throw error;
      }
    },
    onSuccess: (_, watch) => {
      qc.invalidateQueries({ queryKey: ["slack-watch", user?.id, selectedChannel] });
      toast.success(
        watch ? "Canal en seguimiento: te avisaremos de mensajes aquí" : "Dejaste de seguir el canal",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const postMutation = useMutation({
    mutationFn: async (text: string) => {
      const data = await invokeSlackApi<{ ok: boolean; error?: string }>({
        action: "chat.postMessage",
        channel: selectedChannel,
        text,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo enviar");
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["slack-history", selectedChannel] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedMeta = useMemo(() => {
    const list = conversationsQuery.data || [];
    return list.find((c) => c.id === selectedChannel);
  }, [conversationsQuery.data, selectedChannel]);

  const scrollToTs = useCallback(() => {
    if (!tsFromUrl) return;
    const el = document.getElementById(`slack-msg-${tsFromUrl.replace(/\./g, "-")}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [tsFromUrl]);

  useEffect(() => {
    if (!historyQuery.isSuccess || !tsFromUrl) return;
    const t = setTimeout(scrollToTs, 300);
    return () => clearTimeout(t);
  }, [historyQuery.isSuccess, tsFromUrl, scrollToTs]);

  const selectChannel = (id: string) => {
    setSelectedChannel(id);
    setSearchParams({ channel: id });
  };

  if (loadingConn) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isConnected) {
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto animate-fade-in">
          <PageHeader
            title="Comunicación"
            description="Slack desde Kawiil — conecta tu cuenta del workspace"
            icon={<MessageSquare className="h-6 w-6" />}
          />
          <Card className="mt-6 border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Conectar Slack</CardTitle>
              <CardDescription>
                Usa el mismo workspace que el equipo. Tras conectar podrás leer y escribir en los canales y DMs que ya ves en Slack.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => connect()} disabled={isConnecting} className="w-full sm:w-auto">
                {isConnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Abriendo Slack…
                  </>
                ) : (
                  "Conectar con Slack"
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-4 animate-fade-in">
        <PageHeader
          title="Comunicación"
          description={`Slack · equipo ${connection?.slack_team_id?.slice(0, 8)}…`}
          icon={<MessageSquare className="h-6 w-6" />}
        />

        <div className="flex flex-col lg:flex-row gap-4 min-h-[calc(100vh-12rem)]">
          <Card className="lg:w-72 shrink-0 border-border/60 flex flex-col max-h-[50vh] lg:max-h-none">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Conversaciones</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0">
              {conversationsQuery.isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : conversationsQuery.isError ? (
                <p className="text-sm text-destructive px-4 pb-4">
                  {(conversationsQuery.error as Error).message}
                </p>
              ) : (
                <ScrollArea className="h-[40vh] lg:h-[calc(100vh-16rem)]">
                  <div className="pr-3 pb-2 space-y-0.5">
                    {(conversationsQuery.data || []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectChannel(c.id)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
                          selectedChannel === c.id
                            ? "bg-primary/10 text-foreground"
                            : "hover:bg-secondary/60 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {c.is_private || c.is_im ? (
                          <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        ) : (
                          <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        )}
                        <span className="truncate">{convLabel(c)}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1 flex flex-col min-h-0 border-border/60">
            <CardHeader className="py-3 flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {selectedChannel ? convLabel(selectedMeta || { id: selectedChannel }) : "Selecciona una conversación"}
                </CardTitle>
                {selectedChannel && (
                  <CardDescription className="text-xs mt-0.5 font-mono">{selectedChannel}</CardDescription>
                )}
              </div>
              {selectedChannel && (
                <div className="flex items-center gap-2">
                  {isWatching ? (
                    <Bell className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <BellOff className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex items-center gap-2">
                    <Switch
                      id="watch-channel"
                      checked={!!isWatching}
                      disabled={watchMutation.isPending}
                      onCheckedChange={(v) => watchMutation.mutate(v)}
                    />
                    <Label htmlFor="watch-channel" className="text-xs text-muted-foreground cursor-pointer">
                      Avisos de mensajes
                    </Label>
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 pt-0 gap-3">
              {!selectedChannel ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Elige un canal o DM a la izquierda.</p>
              ) : (
                <>
                  <ScrollArea className="flex-1 border border-border/40 rounded-xl bg-card/30 min-h-[280px]">
                    <div className="p-4 space-y-3">
                      {historyQuery.isLoading ? (
                        <div className="flex justify-center py-12">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : historyQuery.isError ? (
                        <p className="text-sm text-destructive">{(historyQuery.error as Error).message}</p>
                      ) : (
                        (historyQuery.data || []).map((m) => {
                          const idSafe = m.ts.replace(/\./g, "-");
                          const highlight = tsFromUrl && m.ts === tsFromUrl;
                          return (
                            <div
                              key={m.ts}
                              id={`slack-msg-${idSafe}`}
                              className={cn(
                                "text-sm rounded-lg px-3 py-2 border border-transparent",
                                highlight && "border-primary/40 bg-primary/[0.06]",
                              )}
                            >
                              <div className="text-[10px] text-muted-foreground font-mono mb-0.5">
                                {m.user || m.bot_id || "sistema"} · {m.ts}
                              </div>
                              <div className="text-foreground whitespace-pre-wrap break-words">
                                {m.text || "(sin texto)"}
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={bottomRef} />
                    </div>
                  </ScrollArea>
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const t = draft.trim();
                      if (!t || postMutation.isPending) return;
                      postMutation.mutate(t);
                    }}
                  >
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Escribe un mensaje…"
                      disabled={postMutation.isPending}
                      className="flex-1"
                    />
                    <Button type="submit" disabled={postMutation.isPending || !draft.trim()}>
                      {postMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
                    </Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
