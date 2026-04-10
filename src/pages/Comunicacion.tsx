import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { useIsMobile } from "@/hooks/use-mobile";
import { invokeSlackApi, invokeSlackFileUpload, type SlackConversation, type SlackMessage } from "@/lib/slackApi";
import { fetchAllSlackConversations } from "@/lib/slackWorkspaceFetch";
import { clearSlackDraft, loadSlackDraft, saveSlackDraft } from "@/lib/slackDrafts";
import { extractSlackUserIdsFromText } from "@/lib/slackFormatting";
import { SlackConnectHero } from "@/components/slack/SlackConnectHero";
import { SlackWorkspaceLayout } from "@/components/slack/SlackWorkspaceLayout";
import { SlackConversationList } from "@/components/slack/SlackConversationList";
import { SlackChannelHeader } from "@/components/slack/SlackChannelHeader";
import { SlackMessageList } from "@/components/slack/SlackMessageList";
import { SlackComposer } from "@/components/slack/SlackComposer";
import { SlackThreadPanel } from "@/components/slack/SlackThreadPanel";
import { SlackNewDmDialog } from "@/components/slack/SlackNewDmDialog";
import { Button } from "@/components/ui/button";
import { conversationTitle } from "@/components/slack/slackGrouping";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";

type HistoryPage = {
  messages: SlackMessage[];
  nextCursor?: string;
};

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MPIM_MEMBERS_BATCH = 40;

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
  const [threadRootTs, setThreadRootTs] = useState<string | null>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);
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

  const conversationsQuery = useQuery({
    queryKey: ["slack-conversations", connection?.id],
    queryFn: () => fetchAllSlackConversations(),
    enabled: isConnected,
    staleTime: 60_000,
  });

  const conversations = conversationsQuery.data || [];

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
    onError: (e: Error) => toast.error(e.message),
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
    onError: (e: Error) => toast.error(e.message),
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
    onError: (e: Error) => toast.error(e.message),
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

  const sidebar = (
    <SlackConversationList
      conversations={conversations}
      userMap={userMap}
      selectedChannel={selectedChannel}
      onSelect={selectChannel}
      isLoading={conversationsQuery.isLoading}
      error={conversationsQuery.error as Error | null}
      titleOpts={titleOpts}
      userId={user?.id}
      headerActions={
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
