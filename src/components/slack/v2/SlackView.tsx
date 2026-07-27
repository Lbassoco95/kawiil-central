import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  invokeSlackApi,
  invokeSlackFileUpload,
  formatSlackFileUploadError,
  withHardTimeout,
  markSlackConversationRead,
  isSlackMarkReadFatal,
  type SlackConversation,
  type SlackMessage,
} from "@/lib/slackApi";
import { saveSlackReadCursor } from "@/lib/slackReadCursor";
import {
  fetchSlackConversationsPaged,
  loadCachedSlackConversations,
  MAX_SLACK_CONV_LIST_PAGES,
  SLACK_CONV_BOOTSTRAP_PAGES,
  SLACK_CONV_LIST_TIMEOUT_MS,
} from "@/lib/slackWorkspaceFetch";
import { saveSlackHistoryCache, loadSlackHistoryCache } from "@/lib/slackHistoryCache";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { useSlackChannelNotificationBadges, markSlackChannelNotificationsRead } from "@/hooks/useSlackChannelNotificationBadges";
import { useSlackUnreadMentionsCount } from "@/hooks/useSlackActivityFeed";
import { useSlackUnreadSync } from "@/hooks/useSlackUnreadSync";
import { useSlackTyping } from "@/hooks/useSlackTyping";
import { useIsMobile } from "@/hooks/use-mobile";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { ChannelSidebar } from "./ChannelSidebar";
import { MessageArea } from "./MessageArea";
import { SlackComposerNew, type SlackComposerHandle } from "./SlackComposerNew";
import { ThreadPanelNew } from "./ThreadPanelNew";
import { SlackChatFileDropZone } from "../SlackChatFileDropZone";
import { KawiilContextPanel } from "./KawiilContextPanel";
import { TypingIndicator } from "./TypingIndicator";
import { SlackGroupsOrganizerDialog } from "@/components/slack/SlackGroupsOrganizerDialog";
import { SlackCreateTaskDialog } from "@/components/slack/SlackCreateTaskDialog";
import { SlackActivityPanel } from "@/components/slack/SlackActivityPanel";

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

// Antes 110s: un spinner de ~2 min si Slack estaba en rate-limit. La Edge ya reintenta
// internamente (tope 25s) y al reabrir se muestra la caché local al instante, así que
// un tope más corto evita el "se queda cargando" y ofrece reintentar antes.
const HISTORY_FIRST_MS   = 45_000;
const HISTORY_FIRST_HARD = 50_000;
const HISTORY_NEXT_MS    = 25_000;
const HISTORY_NEXT_HARD  = 30_000;

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

/**
 * Sube archivos a una conversación (o hilo, si se pasa threadTs). El texto viaja
 * como comentario inicial del primer archivo. Se envían en secuencia y se revisa
 * `ok` de cada respuesta de Slack: si alguno falla, lanza un error legible en vez
 * de fallar en silencio (antes el adjunto "no se enviaba" sin avisar).
 */
async function uploadSlackFiles(
  channel: string,
  files: File[],
  text: string,
  threadTs?: string,
): Promise<void> {
  const trimmed = text.trim();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fd = new FormData();
    fd.append("action", "files.upload");
    fd.append("channel", channel);
    fd.append("file", file, file.name);
    fd.append("filename", file.name);
    if (threadTs) fd.append("thread_ts", threadTs);
    if (i === 0 && trimmed) fd.append("initial_comment", trimmed);
    const res = (await invokeSlackFileUpload(fd)) as { ok?: boolean; error?: string };
    if (!res.ok) throw new Error(formatSlackFileUploadError(res.error));
  }
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
  const [activityOpen, setActivityOpen] = useState(false);
  const composerRef = useRef<SlackComposerHandle>(null);
  const threadComposerRef = useRef<SlackComposerHandle>(null);
  const [taskMsg, setTaskMsg] = useState<SlackMessage | null>(null);
  // En móvil: "sidebar" | "messages"
  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "messages">("sidebar");
  const slackConvGenRef = useRef(0);
  const slackReconnectToastAtRef = useRef(0);
  const prefetchedChannelsRef = useRef<Set<string>>(new Set());

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
          void markSlackChannelNotificationsRead(user.id, id).then(() => {
            void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user.id] });
          });
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

  // ─── Alias locales de conversaciones (nombres personalizados) ──
  const { data: aliasRows = [] } = useQuery({
    queryKey: ["slack-conv-aliases", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("slack_conversation_aliases")
        .select("channel_id, alias")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data || []) as { channel_id: string; alias: string }[];
    },
    enabled: !!user?.id,
  });

  const aliasMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of aliasRows) if (r.alias?.trim()) m[r.channel_id] = r.alias.trim();
    return m;
  }, [aliasRows]);

  const renameMutation = useMutation({
    mutationFn: async ({ channelId, alias }: { channelId: string; alias: string | null }) => {
      const clean = (alias ?? "").trim();
      if (!clean) {
        const { error } = await (supabase as any)
          .from("slack_conversation_aliases")
          .delete()
          .eq("user_id", user!.id)
          .eq("channel_id", channelId);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from("slack_conversation_aliases")
        .upsert(
          { user_id: user!.id, channel_id: channelId, alias: clean },
          { onConflict: "user_id,channel_id" },
        );
      if (error) throw error;
    },
    // Optimista: refleja el nombre al instante (sin esperar red) y revierte si falla.
    onMutate: async ({ channelId, alias }) => {
      const key = ["slack-conv-aliases", user?.id];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: { channel_id: string; alias: string }[] | undefined) => {
        const rows = (old ?? []).filter((r) => r.channel_id !== channelId);
        const clean = (alias ?? "").trim();
        return clean ? [...rows, { channel_id: channelId, alias: clean }] : rows;
      });
      return { prev, key };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar el nombre");
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.alias?.trim() ? "Nombre actualizado" : "Nombre quitado");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["slack-conv-aliases"] });
    },
  });

  // Con el panel de hilo abierto, corre el FAB de IA a la izquierda del panel
  // para que no tape el botón de enviar del composer del hilo.
  useEffect(() => {
    if (isMobile) return;
    const root = document.documentElement;
    if (threadRootTs) {
      root.style.setProperty("--kawiil-fab-right", "calc(480px + 1.5rem)");
    } else {
      root.style.removeProperty("--kawiil-fab-right");
    }
    return () => { root.style.removeProperty("--kawiil-fab-right"); };
  }, [threadRootTs, isMobile]);

  // ─── Historial de mensajes ───────────────────────────────
  const historyQuery = useInfiniteQuery({
    queryKey: ["slack-history-v2", selectedChannel],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, queryKey }): Promise<HistoryPage> => {
      const channelId = queryKey[1] as string;
      if (!channelId) return { messages: [] };
      const base = { action: "conversations.history" as const, channel: channelId, limit: 50 };
      const payload = pageParam ? { ...base, cursor: pageParam } : base;
      const isFirst = pageParam == null;
      let data: { ok: boolean; messages?: SlackMessage[]; response_metadata?: { next_cursor?: string } };
      try {
        data = await withHardTimeout(
          invokeSlackApi<typeof data>(payload, { timeoutMs: isFirst ? HISTORY_FIRST_MS : HISTORY_NEXT_MS }),
          isFirst ? HISTORY_FIRST_HARD : HISTORY_NEXT_HARD,
        );
      } catch {
        throw new Error("No se pudo cargar el historial");
      }
      const msgs = (data.messages ?? []).slice().reverse();
      if (isFirst && msgs.length > 0) {
        saveSlackHistoryCache(selectedChannel, msgs);
      }
      return { messages: msgs, nextCursor: data.response_metadata?.next_cursor };
    },
    getNextPageParam: (first) => first.nextCursor,
    enabled: !!selectedChannel,
    staleTime: 5 * 60_000,
    gcTime: 2 * 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      // Sondea el canal abierto para reflejar mensajes nuevos de Slack aunque no generen
      // notificación dirigida al usuario (canal donde solo es miembro, mensajes propios desde
      // la app nativa, etc.). Antes se apagaba para siempre tras cargar páginas viejas.
      const pages = query.state.data?.pages?.length ?? 0;
      if (pages > 3) return false; // canal con scroll profundo: evita refetch costoso de muchas páginas
      return 60_000; // antes 20s; se apoya en realtime para lo inmediato
    },
    refetchIntervalInBackground: false,
    placeholderData: () => {
      if (!selectedChannel) return undefined;
      const cached = loadSlackHistoryCache(selectedChannel);
      if (!cached?.length) return undefined;
      return { pages: [{ messages: cached }], pageParams: [undefined] };
    },
  });

  const messages = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.messages) ?? [],
    [historyQuery.data],
  );

  // ─── Mark as read ────────────────────────────────────────
  useEffect(() => {
    if (!selectedChannel || !messages.length || historyQuery.isLoading) return;
    const ts = messages[messages.length - 1]?.ts;
    // Guardar cursor local para sincronización bidireccional (detectar no leídos vs Slack nativo)
    if (ts && user?.id) {
      saveSlackReadCursor(user.id, selectedChannel, ts);
    }
    // Marcar leído en Slack y en Supabase al mismo tiempo
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
    if (user?.id) {
      void markSlackChannelNotificationsRead(user.id, selectedChannel).then(() => {
        void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user.id] });
      });
    }
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
          if (row.type !== "slack_message" && row.type !== "slack_mention") return;

          // Identificar el canal de la notificación
          const pipe = (row.entity_ref || "").indexOf("|");
          const notifChannel = pipe > 0 ? row.entity_ref!.slice(0, pipe) : "";
          if (!notifChannel) return;

          // Siempre actualizar badges
          void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", uid] });

          if (notifChannel === channelId) {
            // Canal abierto: mostrar mensaje y marcar leído. Invalida los badges
            // DESPUÉS de marcar (si no, el refetch veía aún la notificación sin leer).
            void historyQuery.refetch();
            void markSlackChannelNotificationsRead(uid, channelId).then(() => {
              void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", uid] });
            });
          } else {
            // Otro canal: pre-cargar en background para que esté listo al hacer clic
            void qc.prefetchInfiniteQuery({
              queryKey: ["slack-history-v2", notifChannel],
              initialPageParam: undefined as string | undefined,
              queryFn: async ({ pageParam, queryKey }) => {
                const ch2 = queryKey[1] as string;
                if (!ch2) return { messages: [] as SlackMessage[], nextCursor: undefined };
                const base = { action: "conversations.history" as const, channel: ch2, limit: 50 };
                const p = pageParam ? { ...base, cursor: pageParam as string } : base;
                try {
                  const data = await withHardTimeout(
                    invokeSlackApi<{ ok: boolean; messages?: SlackMessage[]; response_metadata?: { next_cursor?: string } }>(p, { timeoutMs: HISTORY_FIRST_MS }),
                    HISTORY_FIRST_HARD,
                  );
                  return { messages: (data.messages ?? []).slice().reverse(), nextCursor: data.response_metadata?.next_cursor };
                } catch {
                  return { messages: [] as SlackMessage[], nextCursor: undefined };
                }
              },
              getNextPageParam: (first: HistoryPage) => first.nextCursor,
              pages: 1,
            } as Parameters<typeof qc.prefetchInfiniteQuery>[0]);
          }
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
      }, { timeoutMs: 45_000 });
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
    mutationFn: async ({ text, files }: { text: string; files?: File[] }) => {
      if (!selectedChannel) throw new Error("Sin canal seleccionado");

      if (files && files.length > 0) {
        await uploadSlackFiles(selectedChannel, files, text);
        return;
      }

      const data = await invokeSlackApi<{ ok: boolean; ts?: string }>({
        action: "chat.postMessage",
        channel: selectedChannel,
        text,
      }, { timeoutMs: 30_000 });
      if (!data.ok) throw new Error("No se pudo enviar el mensaje");
    },
    onSuccess: () => {
      void historyQuery.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Error al enviar el mensaje");
    },
  });

  // ─── Programar mensaje (chat.scheduleMessage de Slack) ───
  const scheduleMutation = useMutation({
    mutationFn: async ({ text, postAt }: { text: string; postAt: number }) => {
      if (!selectedChannel) throw new Error("Sin canal seleccionado");
      const data = await invokeSlackApi<{ ok: boolean; error?: string }>(
        { action: "chat.scheduleMessage", channel: selectedChannel, text, post_at: postAt },
        { timeoutMs: 30_000 },
      );
      if (!data.ok) throw new Error(data.error || "No se pudo programar el mensaje");
      return postAt;
    },
    onSuccess: (postAt) => {
      const when = new Date(postAt * 1000).toLocaleString("es-MX", {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
      toast.success(`Mensaje programado para ${when}`);
      // Refresca la previsualización de programados en el panel derecho.
      void qc.invalidateQueries({ queryKey: ["slack-scheduled-messages", selectedChannel] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo programar el mensaje"),
  });

  // ─── Enviar respuesta en hilo ────────────────────────────
  const sendReplyMutation = useMutation({
    mutationFn: async ({ text, files }: { text: string; files?: File[] }) => {
      if (!selectedChannel || !threadRootTs) throw new Error("Sin hilo seleccionado");
      if (files && files.length > 0) {
        await uploadSlackFiles(selectedChannel, files, text, threadRootTs);
        return;
      }
      const data = await invokeSlackApi<{ ok: boolean }>({
        action: "chat.postMessage",
        channel: selectedChannel,
        text,
        thread_ts: threadRootTs,
      }, { timeoutMs: 30_000 });
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
      }, { timeoutMs: 15_000 });
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
    // Todos los DMs (is_im) del sidebar, para resolver su nombre/avatar.
    // useSlackUserProfiles ya acota el total (600) y cachea por id, así que
    // incluirlos todos es seguro y evita que algún DM quede con el ID crudo.
    for (const c of conversations) {
      if (c.is_im && c.user) ids.add(c.user);
    }
    return [...ids];
  }, [messages, conversations]);

  const profilesQuery = useSlackUserProfiles(userIds);
  const userMap = profilesQuery.data ?? {};

  // ─── Miembros de grupos (MPIM) para nombrarlos "Leo, Ana, …" ──
  const mpimIds = useMemo(
    () => conversations.filter((c) => c.is_mpim).map((c) => c.id).sort(),
    [conversations],
  );
  const { data: mpimMembersByChannel = {} } = useQuery({
    queryKey: ["slack-mpim-members-v2", mpimIds.join(",")],
    enabled: mpimIds.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      // Una sola invocación (batch, concurrencia en la edge) en vez de N llamadas.
      try {
        const d = await invokeSlackApi<{ ok: boolean; members_by_channel?: Record<string, string[]> }>(
          { action: "conversations.members.batch", channel_ids: mpimIds.slice(0, 40) },
          { timeoutMs: 30_000 },
        );
        return d.ok && d.members_by_channel ? d.members_by_channel : {};
      } catch {
        return {};
      }
    },
  });

  /** channel_id → "Leo, Ana, Jesús" (nombres de los otros miembros del grupo). */
  const mpimNameByChannel = useMemo(() => {
    const out: Record<string, string> = {};
    const self = connection.slack_user_id;
    for (const [chId, members] of Object.entries(mpimMembersByChannel)) {
      const names = members
        .filter((sid) => sid !== self)
        .map((sid) => {
          const u = userMap[sid];
          return (u?.display_name || u?.real_name || "").trim();
        })
        .filter((n) => n.length > 0);
      const uniq = [...new Set(names)];
      if (uniq.length) out[chId] = uniq.join(", ");
    }
    return out;
  }, [mpimMembersByChannel, userMap, connection.slack_user_id]);

  // ─── Badges no leídos ───────────────────────────────────
  const unreadBadges = useSlackChannelNotificationBadges(user?.id);

  // Marca como leído el canal que estás VIENDO en cuanto tenga badge, sin depender
  // del historial de Slack (que puede tardar/fallar). Así abrir la conversación
  // limpia la notificación de forma confiable. Solo afecta al canal seleccionado.
  const lastBadgeMarkRef = useRef<string>("");
  useEffect(() => {
    if (!user?.id || !selectedChannel) return;
    const count = unreadBadges[selectedChannel] ?? 0;
    if (count <= 0) return;
    const key = `${selectedChannel}:${count}`;
    if (lastBadgeMarkRef.current === key) return; // ya lo intentamos para este conteo
    lastBadgeMarkRef.current = key;
    // Optimista: quita el badge de este canal de inmediato para que la notificación
    // "cambie" al abrir, sin esperar el round-trip a Supabase ni el refetch.
    qc.setQueryData<Record<string, number>>(
      ["slack-channel-notification-badges", user.id],
      (prev) => {
        if (!prev || !(selectedChannel in prev)) return prev;
        const next = { ...prev };
        delete next[selectedChannel];
        return next;
      },
    );
    void markSlackChannelNotificationsRead(user.id, selectedChannel)
      .then(() => qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user.id] }))
      .catch(() => { /* best-effort */ });
  }, [selectedChannel, unreadBadges, user?.id, qc]);

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

  // Cuando aparecen badges nuevos, forzar un snapshot inmediato
  const syncKey = syncChannelIds.join(",");
  useEffect(() => {
    if (!user?.id || !syncKey) return;
    void qc.invalidateQueries({ queryKey: ["slack-unread-snapshot", user.id] });
  }, [syncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Background prefetch: seed memory cache + pre-warm unread channels ──
  const convCount = conversations.length;
  const unreadKey = Object.entries(unreadBadges)
    .filter(([, v]) => v > 0)
    .map(([k]) => k)
    .sort()
    .join(",");
  useEffect(() => {
    if (!convCount) return;

    // Seed React Query memory cache from localStorage — zero API calls, instant channel switch
    for (const conv of conversations) {
      if (qc.getQueryData(["slack-history-v2", conv.id])) continue;
      const cached = loadSlackHistoryCache(conv.id);
      if (cached?.length) {
        qc.setQueryData(["slack-history-v2", conv.id], {
          pages: [{ messages: cached }],
          pageParams: [undefined],
        });
      }
    }

    // Fire background API fetches for unread channels without cache (staggered 900ms)
    const toFetch = Object.entries(unreadBadges)
      .filter(([ch, count]) => {
        if (!count || ch === selectedChannel) return false;
        if (prefetchedChannelsRef.current.has(ch)) return false;
        if (qc.getQueryData(["slack-history-v2", ch])) return false;
        return true;
      })
      .slice(0, 4)
      .map(([ch]) => ch);

    toFetch.forEach((channelId, i) => {
      prefetchedChannelsRef.current.add(channelId);
      window.setTimeout(() => {
        void qc.prefetchInfiniteQuery({
          queryKey: ["slack-history-v2", channelId],
          initialPageParam: undefined as string | undefined,
          queryFn: async () => {
            const data = await invokeSlackApi<{
              ok: boolean;
              messages?: SlackMessage[];
              response_metadata?: { next_cursor?: string };
            }>({ action: "conversations.history", channel: channelId, limit: 40 }, { timeoutMs: HISTORY_FIRST_MS });
            const msgs = (data.messages ?? []).slice().reverse();
            if (msgs.length) saveSlackHistoryCache(channelId, msgs);
            return { messages: msgs, nextCursor: data.response_metadata?.next_cursor };
          },
          staleTime: 5 * 60_000,
          pages: 1,
        } as Parameters<typeof qc.prefetchInfiniteQuery>[0]);
      }, i * 900);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convCount, unreadKey]);

  // ─── Menciones no leídas ────────────────────────────────
  const unreadMentions = useSlackUnreadMentionsCount();

  // ─── Canal actual ────────────────────────────────────────
  const currentConv = useMemo(
    () => conversations.find((c) => c.id === selectedChannel) ?? null,
    [conversations, selectedChannel],
  );

  const channelName = useMemo(() => {
    if (aliasMap[selectedChannel]) return aliasMap[selectedChannel];
    if (!currentConv) return selectedChannel;
    if (currentConv.is_im && currentConv.user) {
      const u = userMap[currentConv.user];
      return u?.display_name || u?.real_name || `@${currentConv.user}`;
    }
    if (currentConv.is_mpim && mpimNameByChannel[selectedChannel]) {
      return mpimNameByChannel[selectedChannel];
    }
    return currentConv.name || selectedChannel;
  }, [currentConv, selectedChannel, userMap, aliasMap, mpimNameByChannel]);

  // Resolver un título amable para CUALQUIER channel_id (no solo el activo).
  // Se usa en el panel de Actividad para mostrar el canal/contraparte de cada item.
  const resolveChannelTitle = useCallback(
    (channelId: string): string | undefined => {
      if (!channelId) return undefined;
      if (aliasMap[channelId]) return aliasMap[channelId];
      const conv = conversations.find((c) => c.id === channelId);
      if (conv) {
        if (conv.is_im && conv.user) {
          const u = userMap[conv.user];
          return u?.display_name || u?.real_name || `@${conv.user}`;
        }
        if (conv.is_mpim && mpimNameByChannel[channelId]) return mpimNameByChannel[channelId];
        if (conv.name) return conv.name;
      }
      if (mpimNameByChannel[channelId]) return mpimNameByChannel[channelId];
      return undefined;
    },
    [aliasMap, conversations, userMap, mpimNameByChannel],
  );

  // Al hacer click en un item de Actividad: saltar al canal y, si es hilo, abrirlo.
  const handleJumpToMessage = useCallback(
    (channelId: string, _ts: string, threadTs?: string | null) => {
      setActivityOpen(false);
      selectChannel(channelId);
      if (threadTs) setThreadRootTs(threadTs);
    },
    [selectChannel],
  );

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
        aliasMap={aliasMap}
        mpimNameByChannel={mpimNameByChannel}
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
        <SlackChatFileDropZone
          className="flex-1 min-h-0"
          enabled={!!selectedChannel}
          busy={sendMutation.isPending}
          onDroppedFileList={(fl) => composerRef.current?.addFiles(Array.from(fl))}
        >
          <MessageArea
            channel={currentConv}
            channelId={selectedChannel}
            alias={aliasMap[selectedChannel]}
            mpimName={mpimNameByChannel[selectedChannel]}
            onRename={(alias) =>
              selectedChannel && renameMutation.mutate({ channelId: selectedChannel, alias })
            }
            messages={messages}
            isLoading={historyQuery.isLoading}
            isError={historyQuery.isError}
            onRetry={() => void historyQuery.refetch()}
            hasMore={!!historyQuery.hasNextPage}
            isFetchingNextPage={historyQuery.isFetchingNextPage}
            onLoadMore={() => void historyQuery.fetchNextPage()}
            onOpenThread={(ts) => setThreadRootTs(ts)}
            userMap={userMap}
            selfUserId={connection.slack_user_id ?? undefined}
            onOpenAi={() => {}}
            onOpenActivity={() => setActivityOpen(true)}
            onReact={handleReact}
            onCreateTask={handleCreateTask}
            onBack={isMobile ? () => setMobilePanel("sidebar") : undefined}
          />
          <TypingIndicator typingUsers={typingUsers} />
          <SlackComposerNew
            ref={composerRef}
            channelName={channelName}
            isSending={sendMutation.isPending}
            onSend={(text, files) => {
              sendMutation.mutate({ text, files });
              onStopTyping();
            }}
            onSchedule={(text, postAt) => scheduleMutation.mutate({ text, postAt })}
            disabled={!selectedChannel}
            userMap={userMap}
            onTyping={onTyping}
          />
        </SlackChatFileDropZone>

        {/* Panel de hilo sobre los mensajes */}
        <ThreadPanelNew
          open={!!threadRootTs}
          onClose={() => setThreadRootTs(null)}
          channelId={selectedChannel}
          rootMessage={rootMessage}
          replies={threadReplies}
          isLoading={threadQuery.isLoading}
          isSending={sendReplyMutation.isPending}
          composerRef={threadComposerRef}
          onDropFiles={(files) => threadComposerRef.current?.addFiles(files)}
          onSendReply={(text, files) => sendReplyMutation.mutate({ text, files })}
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
          onOpenActivity={() => setActivityOpen(true)}
        />
      )}

      {/* Panel de Actividad — drawer fijo a la derecha (fuera del grid de columnas
          para no descuadrar el layout; con backdrop para cerrar al hacer clic fuera). */}
      {activityOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px]"
            onClick={() => setActivityOpen(false)}
            aria-hidden
          />
          <div className="fixed top-0 right-0 z-50 h-screen flex">
            <SlackActivityPanel
              open={activityOpen}
              onClose={() => setActivityOpen(false)}
              onJumpToMessage={handleJumpToMessage}
              resolveChannelTitle={resolveChannelTitle}
            />
          </div>
        </>
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
