import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  invokeSlackApi,
  withHardTimeout,
  markSlackConversationRead,
  isSlackMarkReadFatal,
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
import { useSlackChannelNotificationBadges, markSlackChannelNotificationsRead } from "@/hooks/useSlackChannelNotificationBadges";
import { useSlackUnreadMentionsCount } from "@/hooks/useSlackActivityFeed";
import { useSlackUnreadSync } from "@/hooks/useSlackUnreadSync";
import { useSlackTyping } from "@/hooks/useSlackTyping";
import { useIsMobile } from "@/hooks/use-mobile";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { ChannelSidebar } from "./ChannelSidebar";
import { MessageArea } from "./MessageArea";
import { SlackComposerNew } from "./SlackComposerNew";
import { ThreadPanelNew } from "./ThreadPanelNew";
import { KawiilContextPanel } from "./KawiilContextPanel";
import { TypingIndicator } from "./TypingIndicator";
import { SlackGroupsOrganizerDialog } from "@/components/slack/SlackGroupsOrganizerDialog";
import { SlackCreateTaskDialog } from "@/components/slack/SlackCreateTaskDialog";

// ─── Tipos ───────────────────────────────────────────────────
type HistoryPage = {
  messages: SlackMessage[];
  nextCursor?: string;
};

type RawSidebarGroup = {
  id: string;
  title: string;
  sort_order: number;
  slack_sidebar_group_channels: { channel_id: string; sort_order: number }[];
};

const HISTORY_FIRST_MS   = 110_000;
const HISTORY_FIRST_HARD = 118_000;
const HISTORY_NEXT_MS    = 55_000;
const HISTORY_NEXT_HARD  = 62_000;

const SLACK_PERMISSION_TOAST_MS = 14_000;

// ─── Props ───────────────────────────────────────────────────
interface Connection {
  id: string;
  slack_user_id: string | null;
  slack_team_id: string | null;
}

interface Props {
  connection: Connection;
  onRefreshConversations?: () => void;
  onConnect?: () => void;
  isConnecting?: boolean;
}

// ─── Componente ──────────────────────────────────────────────
export function SlackView({ connection, onRefreshConversations, onConnect, isConnecting }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const channelFromUrl = searchParams.get("channel") || "";
  const [selectedChannel, setSelectedChannel] = useState<string>(channelFromUrl);
  const [threadRootTs, setThreadRootTs] = useState<string | null>(null);
  const [groupsDialogOpen, setGroupsDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskMsg, setTaskMsg] = useState<SlackMessage | null>(null);
  // En móvil: "sidebar" | "messages"
  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "messages">("sidebar");
  const slackConvGenRef = useRef(0);
  const slackReconnectToastAtRef = useRef(0);

  // Sincronizar con URL
  useEffect(() => {
    if (channelFromUrl && channelFromUrl !== selectedChannel) {
      setSelectedChannel(channelFromUrl);
    }
  }, [channelFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectChannel = useCallback(
    (id: string) => {
      if (id !== selectedChannel) {
        setSelectedChannel(id);
        setThreadRootTs(null);
        setSearchParams({ channel: id });
        // Limpiar badges de notificaciones inmediatamente al entrar al canal
        if (user?.id) {
          void markSlackChannelNotificationsRead(user.id, id);
        }
      }
      // En móvil, navegar a la vista de mensajes
      if (isMobile) setMobilePanel("messages");
    },
    [selectedChannel, setSearchParams, user?.id, isMobile],
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

  // ─── Organización del usuario ────────────────────────────
  const { data: orgId } = useQuery({
    queryKey: ["user-org-id", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data?.organization_id as string | null) ?? null;
    },
    enabled: !!user?.id,
    staleTime: 30 * 60_000,
  });

  // ─── Grupos custom de Supabase ───────────────────────────
  const { data: sidebarGroupsRaw = [] } = useQuery({
    queryKey: ["slack-sidebar-groups", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slack_sidebar_groups")
        .select("id, title, sort_order, slack_sidebar_group_channels(channel_id, sort_order)")
        .eq("user_id", user!.id)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as RawSidebarGroup[];
    },
    enabled: !!user?.id,
  });

  const customGroupsVm = useMemo(() => {
    const sortedG = [...sidebarGroupsRaw].sort((a, b) => a.sort_order - b.sort_order);
    return sortedG.map((g) => {
      const ch = [...(g.slack_sidebar_group_channels || [])].sort((a, b) => a.sort_order - b.sort_order);
      const convs = ch
        .map((r) => conversations.find((c) => c.id === r.channel_id))
        .filter(Boolean) as SlackConversation[];
      return { id: g.id, title: g.title, conversations: convs };
    });
  }, [sidebarGroupsRaw, conversations]);

  const channelsInCustomGroups = useMemo(() => {
    const s = new Set<string>();
    for (const g of sidebarGroupsRaw) {
      for (const ch of g.slack_sidebar_group_channels || []) {
        s.add(ch.channel_id);
      }
    }
    return s;
  }, [sidebarGroupsRaw]);

  // ─── Historial de mensajes ───────────────────────────────
  const historyQuery = useInfiniteQuery({
    queryKey: ["slack-history-v2", selectedChannel],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<HistoryPage> => {
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
    // Polling fallback para canales donde el webhook Slack Events puede no estar configurado
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      const pages = query.state.data?.pages?.length ?? 0;
      if (pages !== 1) return false; // no re-paginar si hay múltiples páginas
      return 60_000;
    },
    refetchIntervalInBackground: false,
  });

  const messages = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.messages) ?? [],
    [historyQuery.data],
  );

  // ─── Mark as read ────────────────────────────────────────
  useEffect(() => {
    if (!selectedChannel || !messages.length || historyQuery.isLoading) return;
    const ts = messages[messages.length - 1]?.ts;
    void markSlackConversationRead(selectedChannel, ts).catch((err) => {
      if (isSlackMarkReadFatal(err)) {
        const now = Date.now();
        if (now - slackReconnectToastAtRef.current > 60_000) {
          slackReconnectToastAtRef.current = now;
          toast.error(
            "Tu sesión de Slack no permite marcar mensajes como leídos. Pulsa «Actualizar permisos Slack» en la barra lateral.",
            { duration: SLACK_PERMISSION_TOAST_MS },
          );
        }
      }
    });
  }, [selectedChannel, messages, historyQuery.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Realtime: nuevos mensajes de Slack → refrescar historial ──
  useEffect(() => {
    if (!user?.id || !selectedChannel) return;
    const uid = user.id;
    const channelId = selectedChannel;

    const ch = supabase
      .channel(`slack-live-${uid}-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          const row = payload.new as {
            entity_type?: string;
            entity_ref?: string;
            type?: string;
          };
          if (row.entity_type !== "slack") return;
          if (!row.entity_ref?.startsWith(`${channelId}|`)) return;
          if (row.type !== "slack_message" && row.type !== "slack_mention") return;
          // Mensaje nuevo en el canal abierto: mostrar y limpiar badge
          void historyQuery.refetch();
          void markSlackChannelNotificationsRead(uid, channelId);
          void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", uid] });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [user?.id, selectedChannel]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ─── Reacciones ─────────────────────────────────────────
  const reactionMutation = useMutation({
    mutationFn: async ({ ts, emoji }: { ts: string; emoji: string }) => {
      const name = emoji.replace(/^:|:$/g, "").trim();
      if (!selectedChannel || !name) throw new Error("Sin canal o emoji");
      await invokeSlackApi<{ ok: boolean }>({
        action: "reactions.add",
        channel: selectedChannel,
        ts,
        name,
      }, 15_000);
    },
    onSuccess: () => {
      void historyQuery.refetch();
      void threadQuery.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "No se pudo agregar la reacción");
    },
  });

  const handleReact = useCallback((ts: string, emoji: string) => {
    reactionMutation.mutate({ ts, emoji });
  }, [reactionMutation]);

  // ─── Perfiles de usuarios ────────────────────────────────
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    // Autores del canal visible + participantes de hilos
    for (const m of messages) {
      if (m.user) ids.add(m.user);
      if (m.reply_users) m.reply_users.forEach((u) => ids.add(u));
    }
    // Solo los primeros 50 DMs del sidebar (nombres/avatares en lista)
    let dmCount = 0;
    for (const c of conversations) {
      if (c.is_im && c.user && dmCount < 50) {
        ids.add(c.user);
        dmCount++;
      }
    }
    return [...ids];
  }, [messages, conversations]);

  const profilesQuery = useSlackUserProfiles(userIds);
  const userMap = profilesQuery.data ?? {};

  // ─── Badges no leídos ───────────────────────────────────
  const unreadBadges = useSlackChannelNotificationBadges(user?.id);

  // Canales con badge para sincronizar contra Slack (máx 18, priorizando mayor conteo)
  const syncChannelIds = useMemo(() => {
    const CAP = 18;
    return Object.entries(unreadBadges)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, CAP)
      .map(([id]) => id);
  }, [unreadBadges]);

  // ─── Sincronización Slack→Kawiil: limpiar badges de canales leídos en la app nativa ──
  useSlackUnreadSync({
    enabled: true,
    userId: user?.id,
    selectedChannel,
    localUnreadByChannel: unreadBadges,
    pollChannelIds: syncChannelIds,
    holdUnreadSnapshot: historyQuery.isLoading,
  });

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

  // ─── Nombre del usuario actual (para typing indicator) ─────
  const currentUserName = useMemo(() => {
    if (!connection.slack_user_id) return "Tú";
    const p = userMap[connection.slack_user_id];
    return p?.display_name || p?.real_name || "Tú";
  }, [connection.slack_user_id, userMap]);

  const currentUserAvatar = useMemo(() => {
    if (!connection.slack_user_id) return undefined;
    return userMap[connection.slack_user_id]?.avatar_url ?? undefined;
  }, [connection.slack_user_id, userMap]);

  // ─── Typing indicator ────────────────────────────────────
  const { typingUsers, onTyping, onStopTyping } = useSlackTyping(
    selectedChannel || null,
    currentUserName,
    currentUserAvatar,
  );

  // ─── Workspace switcher ──────────────────────────────────
  const workspaces = useMemo(() => [{
    id: "kawiil",
    name: "Kawiil",
    initial: "K",
    colorClass: "blue",
    isActive: true,
    unread: Object.values(unreadBadges).reduce((a, b) => a + b, 0),
  }], [unreadBadges]);

  const handleCreateTask = useCallback((msg: SlackMessage) => {
    setTaskMsg(msg);
    setTaskDialogOpen(true);
  }, []);

  // Nombre del autor del mensaje seleccionado para el diálogo de tarea
  const taskMsgAuthorLabel = useMemo(() => {
    if (!taskMsg?.user) return "";
    const p = userMap[taskMsg.user];
    return p?.display_name || p?.real_name || taskMsg.user;
  }, [taskMsg, userMap]);

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className={`slack-layout${isMobile ? " slack-layout--mobile" : ""}`}>
      {/* Col 1 — Workspaces (oculto en móvil) */}
      {!isMobile && <WorkspaceSwitcher workspaces={workspaces} onSelect={() => {}} />}

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
        customGroups={customGroupsVm}
        channelsInCustomGroups={channelsInCustomGroups}
        onConnect={onConnect}
        isConnecting={isConnecting}
        onOpenGroupsDialog={() => setGroupsDialogOpen(true)}
        onRefresh={() => {
          void conversationsQuery.refetch();
          onRefreshConversations?.();
        }}
        mobileHidden={isMobile && mobilePanel === "messages"}
      />

      {/* Col 3 — Área de mensajes */}
      <div
        className="sl-msg-col"
        data-mobile-hidden={isMobile && mobilePanel === "sidebar" ? "true" : undefined}
      >
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
          onReact={handleReact}
          onCreateTask={handleCreateTask}
          onBack={isMobile ? () => setMobilePanel("sidebar") : undefined}
        />
        <TypingIndicator typingUsers={typingUsers} />
        <SlackComposerNew
          channelName={channelName}
          isSending={sendMutation.isPending}
          onSend={(text) => {
            sendMutation.mutate(text);
            onStopTyping();
          }}
          disabled={!selectedChannel}
          userMap={userMap}
          onTyping={onTyping}
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
          onReact={handleReact}
          onCreateTask={handleCreateTask}
          userMap={userMap}
          selfUserId={connection.slack_user_id ?? undefined}
        />
      </div>

      {/* Col 4 — Panel contexto Kawiil (oculto en móvil) */}
      {!isMobile && (
        <KawiilContextPanel
          channelId={selectedChannel}
          channelName={channelName}
          currentConv={currentConv}
          userMap={userMap}
          unreadMentions={unreadMentions}
          onOpenActivity={() => {}}
        />
      )}

      {/* Diálogo organizar secciones */}
      {orgId && (
        <SlackGroupsOrganizerDialog
          open={groupsDialogOpen}
          onOpenChange={setGroupsDialogOpen}
          conversations={conversations}
          organizationId={orgId}
          userMap={userMap}
        />
      )}

      {/* Diálogo crear tarea desde mensaje */}
      <SlackCreateTaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        message={taskMsg}
        channelId={selectedChannel}
        channelTitle={channelName}
        authorLabel={taskMsgAuthorLabel}
      />
    </div>
  );
}
