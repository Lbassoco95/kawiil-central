import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { useIsMobile } from "@/hooks/use-mobile";
import { invokeSlackApi, type SlackConversation, type SlackMessage } from "@/lib/slackApi";
import { SlackConnectHero } from "@/components/slack/SlackConnectHero";
import { SlackWorkspaceLayout } from "@/components/slack/SlackWorkspaceLayout";
import { SlackConversationList } from "@/components/slack/SlackConversationList";
import { SlackChannelHeader } from "@/components/slack/SlackChannelHeader";
import { SlackMessageList } from "@/components/slack/SlackMessageList";
import { SlackComposer } from "@/components/slack/SlackComposer";
import { conversationTitle } from "@/components/slack/slackGrouping";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Comunicacion() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { isConnected, isLoading: loadingConn, connect, isConnecting, connection } = useSlackConnection();
  const [mobileListOpen, setMobileListOpen] = useState(false);

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

  const conversations = conversationsQuery.data || [];

  const historyQuery = useQuery({
    queryKey: ["slack-history", selectedChannel],
    queryFn: async () => {
      const data = await invokeSlackApi<{ ok: boolean; messages?: SlackMessage[]; error?: string }>({
        action: "conversations.history",
        channel: selectedChannel,
        limit: 80,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo cargar el historial");
      return [...(data.messages || [])].reverse();
    },
    enabled: isConnected && !!selectedChannel,
  });

  const messages = historyQuery.data || [];

  const slackUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversations) {
      if (c.is_im && c.user) ids.add(c.user);
    }
    for (const m of messages) {
      if (m.user) ids.add(m.user);
    }
    return [...ids];
  }, [conversations, messages]);

  const { data: userMap = {} } = useSlackUserProfiles(slackUserIds);

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
    return conversations.find((c) => c.id === selectedChannel);
  }, [conversations, selectedChannel]);

  const headerTitle = selectedMeta
    ? conversationTitle(selectedMeta, userMap)
    : "Selecciona una conversación";

  const showHash =
    !!selectedMeta && !selectedMeta.is_im && !selectedMeta.is_mpim && !selectedMeta.is_private;

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
    setMobileListOpen(false);
  };

  if (loadingConn) {
    return (
      <AppLayout contentMaxWidth="full">
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isConnected) {
    return (
      <AppLayout contentMaxWidth="full">
        <SlackConnectHero onConnect={() => connect()} isConnecting={isConnecting} />
      </AppLayout>
    );
  }

  const sidebar = (
    <SlackConversationList
      conversations={conversations}
      userMap={userMap}
      selectedChannel={selectedChannel}
      onSelect={selectChannel}
      isLoading={conversationsQuery.isLoading}
      error={conversationsQuery.error as Error | null}
    />
  );

  const main = (
    <>
      {selectedChannel ? (
        <>
          <SlackChannelHeader
            title={headerTitle}
            channelId={selectedChannel}
            showHash={showHash}
            isWatching={!!isWatching}
            onWatchChange={(v) => watchMutation.mutate(v)}
            watchPending={watchMutation.isPending}
            showSidebarTrigger={isMobile}
            onOpenSidebar={() => setMobileListOpen(true)}
          />
          <SlackMessageList
            messages={messages}
            userMap={userMap}
            highlightTs={tsFromUrl}
            isLoading={historyQuery.isLoading}
            error={historyQuery.error as Error | null}
            bottomRef={bottomRef}
          />
          <SlackComposer
            value={draft}
            onChange={setDraft}
            onSend={() => postMutation.mutate(draft.trim())}
            disabled={!selectedChannel}
            sending={postMutation.isPending}
          />
        </>
      ) : (
        <div className="flex flex-1 min-h-[min(480px,70vh)] flex-col items-center justify-center px-6 py-20 text-center">
          <p className="text-sm font-medium text-foreground">Elige una conversación</p>
          <p className="text-xs text-muted-foreground mt-2 max-w-sm">
            Usa la lista a la izquierda{isMobile ? " (botón de menú arriba)" : ""} para abrir un canal o un mensaje directo.
          </p>
        </div>
      )}
    </>
  );

  return (
    <AppLayout contentMaxWidth="full">
      <SlackWorkspaceLayout
        sidebar={sidebar}
        main={<div className="flex flex-col flex-1 min-h-0">{main}</div>}
        mobileListOpen={mobileListOpen}
        onMobileListOpenChange={setMobileListOpen}
      />
    </AppLayout>
  );
}
