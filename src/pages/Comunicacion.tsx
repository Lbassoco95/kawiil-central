import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useUserRole } from "@/hooks/useUserRole";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  invokeSlackApi,
  invokeSlackFileUpload,
  isSlackPermissionDeniedMessage,
  SLACK_CHAT_API_PERMISSION_HINT,
  SLACK_FILE_UPLOAD_PERMISSION_HINT,
  SLACK_PERMISSION_TOAST_MS,
  type SlackConversation,
  type SlackMessage,
} from "@/lib/slackApi";
import { fetchAllSlackConversations } from "@/lib/slackWorkspaceFetch";
import { clearSlackDraft, loadSlackDraft, saveSlackDraft } from "@/lib/slackDrafts";
import { extractSlackUserIdsFromText } from "@/lib/slackFormatting";
import { SlackConnectHero } from "@/components/slack/SlackConnectHero";
import { SlackWorkspaceLayout } from "@/components/slack/SlackWorkspaceLayout";
import { SlackConversationList, type SlackCommPrefRow } from "@/components/slack/SlackConversationList";
import { SlackStatusPresets } from "@/components/slack/SlackStatusPresets";
import { SlackGroupsOrganizerDialog } from "@/components/slack/SlackGroupsOrganizerDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SlackChannelHeader } from "@/components/slack/SlackChannelHeader";
import { SlackMessageList } from "@/components/slack/SlackMessageList";
import { SlackComposer } from "@/components/slack/SlackComposer";
import { SlackThreadPanel } from "@/components/slack/SlackThreadPanel";
import { SlackNewDmDialog } from "@/components/slack/SlackNewDmDialog";
import { Button } from "@/components/ui/button";
import { conversationTitle } from "@/components/slack/slackGrouping";
import { Bell, Layers, Loader2, MessageSquarePlus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type HistoryPage = {
  messages: SlackMessage[];
  nextCursor?: string;
};

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MPIM_MEMBERS_BATCH = 40;
const PUSH_BANNER_DISMISS_KEY = "kawiil-slack-push-banner-dismissed";

type RawSidebarGroup = {
  id: string;
  title: string;
  sort_order: number;
  slack_sidebar_group_channels: { channel_id: string; sort_order: number }[] | null;
};

export default function Comunicacion() {
  const { user } = useAuth();
  const { isTransformador } = useUserRole();
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
  const [threadRootTs, setThreadRootTs] = useState<string | null>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [groupsDialogOpen, setGroupsDialogOpen] = useState(false);
  const [pushBannerDismissed, setPushBannerDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(PUSH_BANNER_DISMISS_KEY) === "1",
  );
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout>>();

  const switchChannel = useCallback(
    (id: string, updateUrl: boolean) => {
      if (id === selectedChannel) {
        setMobileListOpen(false);
        return;
      }
      if (user?.id && selectedChannel && selectedChannel !== id) {
        if (draft.trim()) saveSlackDraft(user.id, selectedChannel, draft);
        else clearSlackDraft(user.id, selectedChannel);
      }
      const nextDraft = user?.id ? loadSlackDraft(user.id, id)?.text ?? "" : "";
      setDraft(nextDraft);
      setSelectedChannel(id);
      if (updateUrl) {
        setSearchParams({ channel: id });
      }
      setMobileListOpen(false);
      setThreadRootTs(null);
    },
    [user?.id, selectedChannel, draft, setSearchParams],
  );

  useEffect(() => {
    if (!channelFromUrl || channelFromUrl === selectedChannel) return;
    switchChannel(channelFromUrl, false);
  }, [channelFromUrl, selectedChannel, switchChannel]);

  useEffect(() => {
    if (!user?.id || !selectedChannel) return;
    setDraft((prev) => (prev === "" ? loadSlackDraft(user.id, selectedChannel)?.text ?? "" : prev));
  }, [user?.id, selectedChannel]);

  useEffect(() => {
    if (!user?.id || !selectedChannel) return;
    clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      if (draft.trim()) saveSlackDraft(user.id, selectedChannel, draft);
      else clearSlackDraft(user.id, selectedChannel);
    }, 500);
    return () => clearTimeout(draftSaveTimer.current);
  }, [draft, user?.id, selectedChannel]);

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

  const { data: slackCommPrefs = [], isFetched: slackPrefsFetched } = useQuery({
    queryKey: ["slack-comm-prefs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("slack_communication_prefs").select("*").eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && isConnected,
  });

  const vapidConfigured = !!(import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();

  const { data: pushSetup } = useQuery({
    queryKey: ["comunicacion-push-setup", user?.id],
    queryFn: async () => {
      const [{ count }, { data: prof }] = await Promise.all([
        supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user!.id),
        supabase.from("profiles").select("desktop_push_notifications").eq("user_id", user!.id).single(),
      ]);
      return {
        subCount: count ?? 0,
        desktopPush: prof?.desktop_push_notifications === true,
      };
    },
    enabled: !!user?.id && isConnected,
  });

  const commPrefsByChannel = useMemo(() => {
    const r: Record<string, SlackCommPrefRow> = {};
    for (const row of slackCommPrefs) {
      r[row.channel_id] = {
        is_vip: row.is_vip,
        is_starred: row.is_starred,
        sort_order: row.sort_order,
      };
    }
    return r;
  }, [slackCommPrefs]);

  const savePrefMutation = useMutation({
    mutationFn: async (p: {
      delete?: boolean;
      channelId: string;
      is_vip?: boolean;
      is_starred?: boolean;
      sort_order?: number;
    }) => {
      if (!user?.id || !profile?.organization_id) throw new Error("Sin sesión u organización");
      if (p.delete) {
        const { error } = await supabase
          .from("slack_communication_prefs")
          .delete()
          .eq("user_id", user.id)
          .eq("channel_id", p.channelId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("slack_communication_prefs").upsert(
        {
          user_id: user.id,
          organization_id: profile.organization_id,
          channel_id: p.channelId,
          is_vip: p.is_vip!,
          is_starred: p.is_starred!,
          sort_order: p.sort_order!,
        },
        { onConflict: "user_id,channel_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["slack-comm-prefs", user?.id] }),
  });

  const reorderPrefsMutation = useMutation({
    mutationFn: async (rows: { channelId: string; is_vip: boolean; is_starred: boolean; sort_order: number }[]) => {
      if (!user?.id || !profile?.organization_id) throw new Error("Sin sesión u organización");
      for (const r of rows) {
        const { error } = await supabase.from("slack_communication_prefs").upsert(
          {
            user_id: user.id,
            organization_id: profile.organization_id,
            channel_id: r.channelId,
            is_vip: r.is_vip,
            is_starred: r.is_starred,
            sort_order: r.sort_order,
          },
          { onConflict: "user_id,channel_id" },
        );
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["slack-comm-prefs", user?.id] }),
  });

  const reorderCustomGroupMutation = useMutation({
    mutationFn: async ({ groupId, ids }: { groupId: string; ids: string[] }) => {
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase
          .from("slack_sidebar_group_channels")
          .update({ sort_order: i })
          .eq("group_id", groupId)
          .eq("channel_id", ids[i]);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["slack-sidebar-groups", user?.id] }),
  });

  const conversationsQuery = useQuery({
    queryKey: ["slack-conversations", connection?.id],
    queryFn: () => fetchAllSlackConversations(),
    enabled: isConnected,
    staleTime: 60_000,
  });

  const conversations = conversationsQuery.data || [];

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
    enabled: !!user?.id && isConnected,
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

  const handleReorderCustomGroup = useCallback(
    (groupId: string, orderedChannelIds: string[]) => {
      reorderCustomGroupMutation.mutate({ groupId, ids: orderedChannelIds });
    },
    [reorderCustomGroupMutation],
  );

  useEffect(() => {
    if (!user?.id || !profile?.organization_id || !isConnected || !conversationsQuery.isSuccess || !slackPrefsFetched) {
      return;
    }
    const mark = `slack-prefs-migrated-${user.id}`;
    if (localStorage.getItem(mark)) return;
    if (slackCommPrefs.length > 0) return;
    let ids: string[] = [];
    try {
      const raw = localStorage.getItem(`slack-sidebar-fav-${user.id}`);
      ids = raw ? (JSON.parse(raw) as unknown[]) : [];
      if (!Array.isArray(ids)) ids = [];
    } catch {
      localStorage.setItem(mark, "1");
      return;
    }
    ids = ids.filter((x): x is string => typeof x === "string" && conversations.some((c) => c.id === x));
    if (ids.length === 0) {
      localStorage.setItem(mark, "1");
      return;
    }
    void (async () => {
      const rows = ids.map((channel_id, i) => ({
        user_id: user.id,
        organization_id: profile.organization_id,
        channel_id,
        is_vip: false,
        is_starred: true,
        sort_order: i,
      }));
      const { error } = await supabase.from("slack_communication_prefs").upsert(rows, {
        onConflict: "user_id,channel_id",
      });
      if (!error) {
        localStorage.setItem(mark, "1");
        qc.invalidateQueries({ queryKey: ["slack-comm-prefs", user.id] });
      }
    })();
  }, [
    user?.id,
    profile?.organization_id,
    isConnected,
    conversationsQuery.isSuccess,
    conversations,
    slackPrefsFetched,
    slackCommPrefs.length,
    qc,
  ]);

  const handleToggleVip = useCallback(
    (channelId: string) => {
      const cur = commPrefsByChannel[channelId] || { is_vip: false, is_starred: false, sort_order: 0 };
      const nv = !cur.is_vip;
      if (!nv && !cur.is_starred) {
        savePrefMutation.mutate({ channelId, delete: true });
        return;
      }
      let sort = cur.sort_order;
      if (nv) {
        const orders = Object.values(commPrefsByChannel)
          .filter((p) => p.is_vip)
          .map((p) => p.sort_order);
        sort = (orders.length ? Math.max(...orders) : -1) + 1;
      }
      savePrefMutation.mutate({
        channelId,
        is_vip: nv,
        is_starred: cur.is_starred,
        sort_order: sort,
      });
    },
    [commPrefsByChannel, savePrefMutation],
  );

  const handleToggleStar = useCallback(
    (channelId: string) => {
      const cur = commPrefsByChannel[channelId] || { is_vip: false, is_starred: false, sort_order: 0 };
      const ns = !cur.is_starred;
      if (!ns && !cur.is_vip) {
        savePrefMutation.mutate({ channelId, delete: true });
        return;
      }
      let sort = cur.sort_order;
      if (ns && !cur.is_starred) {
        const orders = Object.values(commPrefsByChannel)
          .filter((p) => p.is_starred && !p.is_vip)
          .map((p) => p.sort_order);
        sort = (orders.length ? Math.max(...orders) : -1) + 1;
      }
      savePrefMutation.mutate({
        channelId,
        is_vip: cur.is_vip,
        is_starred: ns,
        sort_order: sort,
      });
    },
    [commPrefsByChannel, savePrefMutation],
  );

  const handleReorderVip = useCallback(
    (orderedChannelIds: string[]) => {
      const rows = orderedChannelIds.map((channelId, i) => {
        const cur = commPrefsByChannel[channelId] || { is_vip: true, is_starred: false, sort_order: i };
        return {
          channelId,
          is_vip: true,
          is_starred: cur.is_starred,
          sort_order: i,
        };
      });
      reorderPrefsMutation.mutate(rows);
    },
    [commPrefsByChannel, reorderPrefsMutation],
  );

  const handleReorderStarred = useCallback(
    (orderedChannelIds: string[]) => {
      const rows = orderedChannelIds.map((channelId, i) => {
        const cur = commPrefsByChannel[channelId] || { is_vip: false, is_starred: true, sort_order: i };
        return {
          channelId,
          is_vip: false,
          is_starred: true,
          sort_order: i,
        };
      });
      reorderPrefsMutation.mutate(rows);
    },
    [commPrefsByChannel, reorderPrefsMutation],
  );

  const mpimIds = useMemo(() => conversations.filter((c) => c.is_mpim).map((c) => c.id), [conversations]);

  const { data: mpimMembersByChannel = {} } = useQuery({
    queryKey: ["slack-mpim-members", mpimIds.sort().join(",")],
    queryFn: async () => {
      if (mpimIds.length === 0) return {} as Record<string, string[]>;
      const merged: Record<string, string[]> = {};
      for (let i = 0; i < mpimIds.length; i += MPIM_MEMBERS_BATCH) {
        const slice = mpimIds.slice(i, i + MPIM_MEMBERS_BATCH);
        const d = await invokeSlackApi<{
          ok: boolean;
          members_by_channel?: Record<string, string[]>;
        }>({
          action: "conversations.members.batch",
          channel_ids: slice,
        });
        Object.assign(merged, d.members_by_channel || {});
      }
      return merged;
    },
    enabled: isConnected && mpimIds.length > 0,
    staleTime: 300_000,
  });

  const historyInfinite = useInfiniteQuery({
    queryKey: ["slack-history", selectedChannel],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<HistoryPage> => {
      const data = await invokeSlackApi<{
        ok: boolean;
        messages?: SlackMessage[];
        error?: string;
        response_metadata?: { next_cursor?: string };
      }>({
        action: "conversations.history",
        channel: selectedChannel!,
        limit: 50,
        cursor: pageParam,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo cargar el historial");
      const raw = data.messages || [];
      const chrono = [...raw].reverse();
      const nextCursor = data.response_metadata?.next_cursor || undefined;
      return { messages: chrono, nextCursor };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: isConnected && !!selectedChannel,
  });

  const messages = useMemo(() => {
    const pages = historyInfinite.data?.pages;
    if (!pages?.length) return [];
    return [...pages].reverse().flatMap((p) => p.messages);
  }, [historyInfinite.data]);

  const slackUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversations) {
      if (c.is_im && c.user) ids.add(c.user);
      if (c.is_mpim) {
        const mem = mpimMembersByChannel[c.id];
        if (mem) mem.forEach((id) => ids.add(id));
      }
    }
    for (const m of messages) {
      if (m.user) ids.add(m.user);
      if (m.text) extractSlackUserIdsFromText(m.text).forEach((id) => ids.add(id));
    }
    return [...ids];
  }, [conversations, messages, mpimMembersByChannel]);

  const { data: userMap = {} } = useSlackUserProfiles(slackUserIds);

  const { data: channelMembers = [] } = useQuery({
    queryKey: ["slack-channel-members", selectedChannel],
    queryFn: async () => {
      const d = await invokeSlackApi<{ ok: boolean; members?: string[] }>({
        action: "conversations.members",
        channel: selectedChannel!,
        limit: 200,
      });
      return d.members || [];
    },
    enabled: isConnected && !!selectedChannel,
    staleTime: 120_000,
  });

  const { data: channelInfo } = useQuery({
    queryKey: ["slack-channel-info", selectedChannel],
    queryFn: async () => {
      const d = await invokeSlackApi<{ ok: boolean; channel?: Record<string, unknown> }>({
        action: "conversations.info",
        channel: selectedChannel!,
      });
      return d.ok ? d.channel : null;
    },
    enabled: isConnected && !!selectedChannel,
    staleTime: 120_000,
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

  const toastSlackPermissionDenied = (e: Error, hint: string) => {
    const msg = e.message || "";
    if (isSlackPermissionDeniedMessage(msg)) {
      toast.error(hint, { duration: SLACK_PERMISSION_TOAST_MS });
      return;
    }
    toast.error(msg);
  };

  const onSlackChatMutationError = (e: Error) =>
    toastSlackPermissionDenied(e, SLACK_CHAT_API_PERMISSION_HINT);

  const onSlackFileUploadError = (e: Error) =>
    toastSlackPermissionDenied(e, SLACK_FILE_UPLOAD_PERMISSION_HINT);

  const postMutation = useMutation({
    mutationFn: async (payload: { text: string; thread_ts?: string }) => {
      const data = await invokeSlackApi<{ ok: boolean; error?: string }>({
        action: "chat.postMessage",
        channel: selectedChannel,
        text: payload.text,
        thread_ts: payload.thread_ts,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo enviar");
    },
    onSuccess: (_, vars) => {
      if (!vars.thread_ts) {
        setDraft("");
        if (user?.id && selectedChannel) clearSlackDraft(user.id, selectedChannel);
      }
      qc.invalidateQueries({ queryKey: ["slack-history", selectedChannel] });
      if (vars.thread_ts) {
        qc.invalidateQueries({ queryKey: ["slack-thread", selectedChannel, vars.thread_ts] });
      }
    },
    onError: onSlackChatMutationError,
  });

  const scheduleMutation = useMutation({
    mutationFn: async (postAt: number) => {
      const text = draft.trim();
      if (!text) throw new Error("Escribe un mensaje para programar");
      const data = await invokeSlackApi<{ ok: boolean; error?: string }>({
        action: "chat.scheduleMessage",
        channel: selectedChannel!,
        text,
        post_at: postAt,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo programar el mensaje");
    },
    onSuccess: () => {
      toast.success("Mensaje programado en Slack");
      setDraft("");
      if (user?.id && selectedChannel) clearSlackDraft(user.id, selectedChannel);
    },
    onError: onSlackChatMutationError,
  });

  const uploadMutation = useMutation({
    mutationFn: async (vars: { file: File; initial_comment?: string }) => {
      if (vars.file.size > MAX_UPLOAD_BYTES) throw new Error("El archivo supera 50 MB");
      const form = new FormData();
      form.append("action", "files.upload");
      form.append("channel", selectedChannel!);
      form.append("filename", vars.file.name);
      form.append("file", vars.file);
      if (vars.initial_comment?.trim()) form.append("initial_comment", vars.initial_comment.trim());
      const data = (await invokeSlackFileUpload(form)) as { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(String(data.error || "No se pudo subir el archivo"));
    },
    onSuccess: () => {
      toast.success("Archivo enviado a Slack");
      qc.invalidateQueries({ queryKey: ["slack-history", selectedChannel] });
    },
    onError: onSlackFileUploadError,
  });

  const storedDraftForRestore = useMemo(() => {
    if (!user?.id || !selectedChannel) return null;
    return loadSlackDraft(user.id, selectedChannel);
  }, [user?.id, selectedChannel, draft]);

  const showRestoreDraft = !!(
    storedDraftForRestore?.text &&
    storedDraftForRestore.text !== draft
  );

  const titleOpts = useMemo(
    () => ({
      mpimMembersByChannel,
      slackSelfUserId: connection?.slack_user_id ?? null,
    }),
    [mpimMembersByChannel, connection?.slack_user_id],
  );

  const selectedMeta = useMemo(() => {
    return conversations.find((c) => c.id === selectedChannel);
  }, [conversations, selectedChannel]);

  const headerTitle = selectedMeta
    ? conversationTitle(selectedMeta, userMap, titleOpts)
    : "Selecciona una conversación";

  const showHash =
    !!selectedMeta && !selectedMeta.is_im && !selectedMeta.is_mpim && !selectedMeta.is_private;

  const channelTopic =
    typeof channelInfo?.topic === "object" && channelInfo.topic && "value" in channelInfo.topic
      ? String((channelInfo.topic as { value?: string }).value || "")
      : "";
  const memberCount =
    typeof channelInfo?.num_members === "number" ? channelInfo.num_members : undefined;

  const selectChannel = (id: string) => {
    switchChannel(id, true);
  };

  const composerMemberIds = useMemo(() => {
    const m = new Set(channelMembers);
    slackUserIds.forEach((id) => m.add(id));
    return [...m];
  }, [channelMembers, slackUserIds]);

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

  /** Sin VAPID no tiene sentido pedir “activa en Notificaciones”; solo avisamos del entorno. */
  const showSlackPushBanner =
    isConnected &&
    pushSetup &&
    !pushBannerDismissed &&
    (!vapidConfigured ||
      !pushSetup.desktopPush ||
      pushSetup.subCount === 0);

  const dismissPushBanner = () => {
    try {
      localStorage.setItem(PUSH_BANNER_DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setPushBannerDismissed(true);
  };

  const sidebar = (
    <SlackConversationList
      conversations={conversations}
      userMap={userMap}
      selectedChannel={selectedChannel}
      onSelect={selectChannel}
      isLoading={conversationsQuery.isLoading}
      error={conversationsQuery.error as Error | null}
      titleOpts={titleOpts}
      commPrefsByChannel={commPrefsByChannel}
      onToggleVip={handleToggleVip}
      onToggleStar={handleToggleStar}
      onReorderVip={handleReorderVip}
      onReorderStarred={handleReorderStarred}
      customGroups={customGroupsVm}
      channelsInCustomGroups={channelsInCustomGroups}
      onReorderCustomGroup={handleReorderCustomGroup}
      headerActions={
        <div className="flex flex-col gap-1.5">
          {showSlackPushBanner && (
            <Alert className="border-amber-800/60 bg-amber-950/30 text-amber-100 py-2 px-3">
              <Bell className="h-4 w-4 text-amber-400" />
              <AlertTitle className="text-xs font-semibold mb-1">
                {vapidConfigured ? "Avisos fuera de la app" : "Notificaciones push no disponibles"}
              </AlertTitle>
              <AlertDescription className="text-[11px] text-amber-100/90 leading-snug space-y-1.5">
                {vapidConfigured ? (
                  <p>
                    Para recibir mensajes de Slack con la pestaña cerrada, activa push en{" "}
                    <Link to="/notificaciones" className="underline font-medium text-amber-200">
                      Notificaciones
                    </Link>
                    .
                  </p>
                ) : isTransformador ? (
                  <>
                    <p>
                      Falta Web Push (VAPID) en el despliegue. Configúralo una vez; después cada usuario puede activar push en{" "}
                      <Link to="/notificaciones" className="underline font-medium text-amber-200">
                        Notificaciones
                      </Link>
                      .
                    </p>
                    <details className="rounded border border-amber-800/40 bg-black/20 px-2 py-1.5">
                      <summary className="cursor-pointer text-amber-200/95 font-medium select-none">
                        Pasos técnicos (Lovable y Supabase)
                      </summary>
                      <ul className="list-disc pl-4 mt-2 space-y-0.5 text-amber-200/95">
                        <li>
                          <strong>Lovable / build:</strong>{" "}
                          <code className="rounded bg-black/30 px-1">VITE_VAPID_PUBLIC_KEY</code> (clave pública).
                        </li>
                        <li>
                          <strong>Supabase</strong> → Edge Functions → Secrets:{" "}
                          <code className="rounded bg-black/30 px-1">VAPID_PUBLIC_KEY</code> (misma pública),{" "}
                          <code className="rounded bg-black/30 px-1">VAPID_PRIVATE_KEY</code>,{" "}
                          <code className="rounded bg-black/30 px-1">VAPID_CONTACT_EMAIL</code> (p. ej.{" "}
                          <code className="rounded bg-black/30 px-1">mailto:equipo@tudominio.com</code>).
                        </li>
                        <li>
                          Generar claves:{" "}
                          <code className="rounded bg-black/30 px-1">npx web-push generate-vapid-keys</code>
                        </li>
                      </ul>
                      <p className="text-amber-300/80 mt-1.5">
                        Tras guardar en Lovable, vuelve a publicar el proyecto para que el cliente lea la clave.
                      </p>
                    </details>
                  </>
                ) : (
                  <p>
                    En este entorno no están configuradas las notificaciones fuera de la app. Puedes usar Slack con normalidad; si las necesitas,
                    pide a un administrador que configure VAPID en Lovable y Supabase.
                  </p>
                )}
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] border-amber-700/50 bg-amber-950/40 text-amber-100 hover:bg-amber-900/50"
                    onClick={dismissPushBanner}
                  >
                    Ocultar aviso
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs justify-start gap-2 bg-zinc-800/80 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
            onClick={() => setGroupsDialogOpen(true)}
          >
            <Layers className="h-3.5 w-3.5 shrink-0 opacity-80" />
            Organizar grupos
          </Button>
          <SlackStatusPresets />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full h-8 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700"
            onClick={() => setNewDmOpen(true)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            Nuevo mensaje directo
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full h-7 text-[10px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80"
            onClick={() => connect()}
            disabled={isConnecting}
            title="Vuelve a abrir Slack para aplicar permisos (p. ej. users.profile:write para estado)"
          >
            {isConnecting ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin shrink-0" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1 shrink-0" />
            )}
            Actualizar permisos Slack
          </Button>
        </div>
      }
    />
  );

  const main = (
    <>
      {selectedChannel ? (
        <div className="flex flex-1 min-h-0 min-w-0">
          <div className="flex flex-1 min-w-0 min-h-0 flex-col">
            <SlackChannelHeader
              title={headerTitle}
              channelId={selectedChannel}
              showHash={showHash}
              topic={channelTopic}
              memberCount={memberCount}
              isWatching={!!isWatching}
              onWatchChange={(v) => watchMutation.mutate(v)}
              watchPending={watchMutation.isPending}
              showSidebarTrigger={isMobile}
              onOpenSidebar={() => setMobileListOpen(true)}
              messages={messages}
              onJumpToMessage={(ts) => {
                const el = document.getElementById(`slack-msg-${ts.replace(/\./g, "-")}`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            />
            <SlackMessageList
              messages={messages}
              userMap={userMap}
              highlightTs={tsFromUrl}
              isLoading={historyInfinite.isLoading}
              error={historyInfinite.error as Error | null}
              bottomRef={bottomRef}
              hasMore={historyInfinite.hasNextPage}
              isFetchingMore={historyInfinite.isFetchingNextPage}
              onLoadMore={() => historyInfinite.fetchNextPage()}
              onOpenThread={(ts) => setThreadRootTs(ts)}
              selectedChannelId={selectedChannel}
            />
            <SlackComposer
              value={draft}
              onChange={setDraft}
              onSend={() => postMutation.mutate({ text: draft.trim() })}
              disabled={!selectedChannel}
              sending={postMutation.isPending}
              channelLabel={headerTitle}
              mentionUserIds={composerMemberIds}
              userMap={userMap}
              onSchedule={(postAt) => scheduleMutation.mutate(postAt)}
              scheduling={scheduleMutation.isPending}
              onUploadFile={(file, initial_comment) =>
                uploadMutation.mutate({ file, initial_comment })
              }
              uploading={uploadMutation.isPending}
              showRestoreDraft={showRestoreDraft}
              onRestoreDraft={() => {
                if (storedDraftForRestore?.text) setDraft(storedDraftForRestore.text);
              }}
            />
          </div>
          <SlackThreadPanel
            open={!!threadRootTs}
            onOpenChange={(o) => !o && setThreadRootTs(null)}
            channelId={selectedChannel}
            threadTs={threadRootTs}
            userMap={userMap}
            onReply={(text) => {
              if (!threadRootTs) return;
              postMutation.mutate({ text, thread_ts: threadRootTs });
            }}
            sending={postMutation.isPending}
          />
        </div>
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
      {profile?.organization_id && (
        <SlackGroupsOrganizerDialog
          open={groupsDialogOpen}
          onOpenChange={setGroupsDialogOpen}
          conversations={conversations}
          organizationId={profile.organization_id}
          titleOpts={titleOpts}
          userMap={userMap}
        />
      )}
      <SlackNewDmDialog
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        connectionId={connection?.id}
        slackSelfUserId={connection?.slack_user_id}
        onChannelReady={(channelId) => selectChannel(channelId)}
      />
      <SlackWorkspaceLayout
        sidebar={sidebar}
        main={<div className="flex flex-col flex-1 min-h-0 overflow-hidden">{main}</div>}
        mobileListOpen={mobileListOpen}
        onMobileListOpenChange={setMobileListOpen}
      />
    </AppLayout>
  );
}
