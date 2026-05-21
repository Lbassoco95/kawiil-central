import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  invokeSlackApi,
  withHardTimeout,
  type SlackConversation,
  type SlackMessage,
} from "@/lib/slackApi";
import {
  fetchSlackConversationsPaged,
  loadCachedSlackConversations,
  MAX_SLACK_CONV_LIST_PAGES,
  SLACK_CONV_BOOTSTRAP_PAGES,
  SLACK_CONV_LIST_TIMEOUT_MS,
} from "@/lib/slackWorkspaceFetch";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { useSlackChannelNotificationBadges } from "@/hooks/useSlackChannelNotificationBadges";
import { useSlackUnreadMentionsCount } from "@/hooks/useSlackActivityFeed";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { ChannelSidebar } from "./ChannelSidebar";
import { MessageArea } from "./MessageArea";
import { SlackComposerNew } from "./SlackComposerNew";
import { ThreadPanelNew } from "./ThreadPanelNew";
import { KawiilContextPanel } from "./KawiilContextPanel";

// ─── Tipos ───────────────────────────────────────────────────
type HistoryPage = {
  messages: SlackMessage[];
  nextCursor?: string;
};

const HISTORY_FIRST_MS  = 110_000;
const HISTORY_FIRST_HARD = 118_000;
const HISTORY_NEXT_MS   = 55_000;
const HISTORY_NEXT_HARD = 62_000;

// ─── Props ───────────────────────────────────────────────────
interface Connection {
  id: string;
  slack_user_id: string | null;
  slack_team_id: string | null;
}

interface Props {
  connection: Connection;
  onRefreshConversations?: () => void;
}

// ─── Componente ──────────────────────────────────────────────
export function SlackView({ connection, onRefreshConversations }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const channelFromUrl = searchParams.get("channel") || "";
  const [selectedChannel, setSelectedChannel] = useState<string>(channelFromUrl);
  const [threadRootTs, setThreadRootTs] = useState<string | null>(null);
  const slackConvGenRef = useRef(0);

  // Sincronizar con URL
  useEffect(() => {
    if (channelFromUrl && channelFromUrl !== selectedChannel) {
      setSelectedChannel(channelFromUrl);
    }
  }, [channelFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectChannel = useCallback(
    (id: string) => {
      if (id === selectedChannel) return;
      setSelectedChannel(id);
      setThreadRootTs(null);
      setSearchParams({ channel: id });
    },
    [selectedChannel, setSearchParams],
  );

  // ─── Conversaciones ──────────────────────────────────────
  const conversationsQuery = useQuery({
    queryKey: ["slack-conversations", connection.id],
    queryFn: async () => {
      const gen = ++slackConvGenRef.current;
      const bootstrap = await fetchSlackConversationsPaged({
        cacheConnectionId: connection.id,
        maxPages: SLACK_CONV_BOOTSTRAP_PAGES,
        timeoutMs: SLACK_CONV_LIST_TIMEOUT_MS,
      });
      if (!bootstrap.complete && bootstrap.nextCursor) {
        const restBudget = Math.max(1, MAX_SLACK_CONV_LIST_PAGES - SLACK_CONV_BOOTSTRAP_PAGES);
        void fetchSlackConversationsPaged({
          cacheConnectionId: connection.id,
          maxPages: restBudget,
          startCursor: bootstrap.nextCursor,
          seedConversations: bootstrap.conversations,
          timeoutMs: SLACK_CONV_LIST_TIMEOUT_MS,
        }).then((full) => {
          if (slackConvGenRef.current !== gen) return;
          qc.setQueryData(["slack-conversations", connection.id], full.conversations);
        });
      }
      return bootstrap.conversations;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: () => loadCachedSlackConversations(connection.id),
  });

  const conversations: SlackConversation[] = conversationsQuery.data ?? [];

  // ─── Historial de mensajes ───────────────────────────────
  const historyQuery = useInfiniteQuery({
    queryKey: ["slack-history-v2", selectedChannel],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<HistoryPage> => {
      if (!selectedChannel) return { messages: [] };
      const base = { action: "conversations.history" as const, channel: selectedChannel, limit: 50 };
      const payload = pageParam ? { ...base, cursor: pageParam } : base;
      const isFirst = pageParam == null;
      let data: { ok: boolean; messages?: SlackMessage[]; response_metadata?: { next_cursor?: string } };
      try {
        data = await withHardTimeout(
          invokeSlackApi<typeof data>(payload, isFirst ? HISTORY_FIRST_MS : HISTORY_NEXT_MS),
          isFirst ? HISTORY_FIRST_HARD : HISTORY_NEXT_HARD,
        );
      } catch {
        throw new Error("No se pudo cargar el historial");
      }
      const msgs = (data.messages ?? []).slice().reverse();
      return { messages: msgs, nextCursor: data.response_metadata?.next_cursor };
    },
    getNextPageParam: (first) => first.nextCursor,
    enabled: !!selectedChannel,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const messages = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.messages) ?? [],
    [historyQuery.data],
  );

  // ─── Hilo (replies) ─────────────────────────────────────
  const threadQuery = useQuery({
    queryKey: ["slack-thread-v2", selectedChannel, threadRootTs],
    queryFn: async () => {
      if (!selectedChannel || !threadRootTs) return [];
      const data = await invokeSlackApi<{ ok: boolean; messages?: SlackMessage[] }>({
        action: "conversations.replies",
        channel: selectedChannel,
        ts: threadRootTs,
        limit: 200,
      }, 45_000);
      return data.messages ?? [];
    },
    enabled: !!selectedChannel && !!threadRootTs,
    staleTime: 30_000,
  });

  const threadMessages = threadQuery.data ?? [];
  const rootMessage = threadMessages[0] ?? null;
  const threadReplies = threadMessages.slice(1);

  // ─── Enviar mensaje ─────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!selectedChannel) throw new Error("Sin canal seleccionado");
      const data = await invokeSlackApi<{ ok: boolean; ts?: string }>({
        action: "chat.postMessage",
        channel: selectedChannel,
        text,
      }, 30_000);
      if (!data.ok) throw new Error("No se pudo enviar el mensaje");
      return data;
    },
    onSuccess: () => {
      void historyQuery.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Error al enviar el mensaje");
    },
  });

  // ─── Enviar respuesta en hilo ────────────────────────────
  const sendReplyMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!selectedChannel || !threadRootTs) throw new Error("Sin hilo seleccionado");
      const data = await invokeSlackApi<{ ok: boolean }>({
        action: "chat.postMessage",
        channel: selectedChannel,
        text,
        thread_ts: threadRootTs,
      }, 30_000);
      if (!data.ok) throw new Error("No se pudo enviar la respuesta");
    },
    onSuccess: () => {
      void threadQuery.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Error al responder");
    },
  });

  // ─── Perfiles de usuarios ────────────────────────────────
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messages) {
      if (m.user) ids.add(m.user);
    }
    for (const c of conversations) {
      if (c.is_im && c.user) ids.add(c.user);
    }
    return [...ids];
  }, [messages, conversations]);

  const profilesQuery = useSlackUserProfiles(userIds);
  const userMap = profilesQuery.data ?? {};

  // ─── Badges no leídos ───────────────────────────────────
  const unreadBadges = useSlackChannelNotificationBadges(user?.id);

  // ─── Menciones no leídas ────────────────────────────────
  const unreadMentions = useSlackUnreadMentionsCount();

  // ─── Canal actual ────────────────────────────────────────
  const currentConv = useMemo(
    () => conversations.find((c) => c.id === selectedChannel) ?? null,
    [conversations, selectedChannel],
  );

  const channelName = useMemo(() => {
    if (!currentConv) return selectedChannel;
    if (currentConv.is_im && currentConv.user) {
      const u = userMap[currentConv.user];
      return u?.display_name || u?.real_name || currentConv.user;
    }
    return currentConv.name || selectedChannel;
  }, [currentConv, selectedChannel, userMap]);

  // ─── Workspace switcher ──────────────────────────────────
  const workspaces = useMemo(() => [{
    id: "kawiil",
    name: "Kawiil",
    initial: "K",
    colorClass: "blue",
    isActive: true,
    unread: Object.values(unreadBadges).reduce((a, b) => a + b, 0),
  }], [unreadBadges]);

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="slack-layout">
      {/* Col 1 — Workspaces */}
      <WorkspaceSwitcher workspaces={workspaces} onSelect={() => {}} />

      {/* Col 2 — Canales */}
      <ChannelSidebar
        workspaceName="Kawiil"
        conversations={conversations}
        isLoading={conversationsQuery.isLoading}
        selectedChannel={selectedChannel}
        onSelectChannel={selectChannel}
        unreadByChannel={unreadBadges}
        userMap={userMap}
        onNewMessage={() => {}}
        onRefresh={() => {
          void conversationsQuery.refetch();
          onRefreshConversations?.();
        }}
      />

      {/* Col 3 — Área de mensajes */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <MessageArea
          channel={currentConv}
          channelId={selectedChannel}
          messages={messages}
          isLoading={historyQuery.isLoading}
          hasMore={!!historyQuery.hasNextPage}
          isFetchingNextPage={historyQuery.isFetchingNextPage}
          onLoadMore={() => void historyQuery.fetchNextPage()}
          onOpenThread={(ts) => setThreadRootTs(ts)}
          userMap={userMap}
          selfUserId={connection.slack_user_id ?? undefined}
          onOpenAi={() => {}}
          onOpenActivity={() => {}}
        />
        <SlackComposerNew
          channelName={channelName}
          isSending={sendMutation.isPending}
          onSend={(text) => sendMutation.mutate(text)}
          disabled={!selectedChannel}
        />

        {/* Panel de hilo sobre los mensajes */}
        <ThreadPanelNew
          open={!!threadRootTs}
          onClose={() => setThreadRootTs(null)}
          channelId={selectedChannel}
          rootMessage={rootMessage}
          replies={threadReplies}
          isLoading={threadQuery.isLoading}
          isSending={sendReplyMutation.isPending}
          onSendReply={(text) => sendReplyMutation.mutate(text)}
          userMap={userMap}
          selfUserId={connection.slack_user_id ?? undefined}
        />
      </div>

      {/* Col 4 — Panel contexto Kawiil */}
      <KawiilContextPanel
        channelId={selectedChannel}
        channelName={channelName}
        unreadMentions={unreadMentions}
        onOpenActivity={() => {}}
      />
    </div>
  );
}
