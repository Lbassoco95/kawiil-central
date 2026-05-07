import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SlackMessageList } from "@/components/slack/SlackMessageList";
import { SlackComposer, type SlackComposerHandle } from "@/components/slack/SlackComposer";
import { SlackChatFileDropZone } from "@/components/slack/SlackChatFileDropZone";
import type { SlackDeepLinkPartsCompat } from "@/lib/slackDeepLink";
import {
  invokeSlackApi,
  invokeSlackFileUpload,
  formatSlackHistoryLoadError,
  formatSlackFileUploadError,
  isSlackPermissionDeniedMessage,
  SLACK_CHAT_API_PERMISSION_HINT,
  SLACK_FILE_UPLOAD_PERMISSION_HINT,
  SLACK_PERMISSION_TOAST_MS,
  SLACK_REACTIONS_PERMISSION_HINT,
  type SlackConversation,
  type SlackMessage,
} from "@/lib/slackApi";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { extractSlackUserIdsFromText } from "@/lib/slackFormatting";
import { conversationTitle } from "@/components/slack/slackGrouping";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const HISTORY_LIMIT = 90;
const THREAD_LIMIT = 90;
const WINDOW_SEC = 48 * 3600;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function slackWindowOldestTs(): string {
  return (Date.now() / 1000 - WINDOW_SEC).toFixed(6);
}

function sortMessagesAsc(messages: SlackMessage[]): SlackMessage[] {
  return [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
}

type ListTab = "channel" | "thread";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parsed: SlackDeepLinkPartsCompat | null;
  notificationTitle: string | null;
};

export function SlackQuickReplyPanel({
  open,
  onOpenChange,
  parsed,
  notificationTitle,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isConnected, isLoading: loadingConn, connection } = useSlackConnection();
  const [draft, setDraft] = useState("");
  const [listTab, setListTab] = useState<ListTab>("channel");
  const quickComposerRef = useRef<SlackComposerHandle | null>(null);

  const channelId = parsed?.channel ?? "";
  const hasThread = !!parsed?.replyTs;
  const threadRootTs = parsed?.mainTs ?? "";

  const channelQuery = useQuery({
    queryKey: ["slack-quick-channel-info", channelId],
    queryFn: async () => {
      const data = await invokeSlackApi<{
        ok: boolean;
        error?: string;
        channel?: {
          id?: string;
          name?: string;
          user?: string;
          is_im?: boolean;
          is_mpim?: boolean;
          is_private?: boolean;
        };
      }>({
        action: "conversations.info",
        channel: channelId,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo leer la conversación");
      return data.channel || {};
    },
    enabled: open && isConnected && !!channelId,
    staleTime: 60_000,
  });

  const convMeta: SlackConversation | null = useMemo(() => {
    const ch = channelQuery.data;
    if (!ch?.id && !channelId) return null;
    return {
      id: ch?.id || channelId,
      name: ch?.name,
      user: ch?.user,
      is_im: ch?.is_im,
      is_mpim: ch?.is_mpim,
      is_private: ch?.is_private,
    };
  }, [channelQuery.data, channelId]);

  const historyQuery = useQuery({
    queryKey: ["slack-quick-history", channelId],
    queryFn: async () => {
      const data = await invokeSlackApi<{
        ok: boolean;
        error?: string;
        messages?: SlackMessage[];
      }>({
        action: "conversations.history",
        channel: channelId,
        limit: HISTORY_LIMIT,
        oldest: slackWindowOldestTs(),
      });
      if (!data.ok) throw new Error(formatSlackHistoryLoadError(data.error));
      return sortMessagesAsc(data.messages || []);
    },
    enabled: open && isConnected && !!channelId,
    staleTime: 15_000,
  });

  const threadQuery = useQuery({
    queryKey: ["slack-quick-thread", channelId, parsed?.mainTs],
    queryFn: async () => {
      const data = await invokeSlackApi<{
        ok: boolean;
        error?: string;
        messages?: SlackMessage[];
      }>({
        action: "conversations.replies",
        channel: channelId,
        ts: parsed!.mainTs,
        limit: THREAD_LIMIT,
      });
      if (!data.ok) throw new Error(formatSlackHistoryLoadError(data.error));
      return sortMessagesAsc(data.messages || []);
    },
    enabled: open && isConnected && !!channelId && hasThread,
    staleTime: 15_000,
  });

  const channelMessages = historyQuery.data ?? [];
  const threadMessages = threadQuery.data ?? [];

  const slackUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of channelMessages) {
      if (m.user) ids.add(m.user);
      if (m.text) extractSlackUserIdsFromText(m.text).forEach((id) => ids.add(id));
    }
    for (const m of threadMessages) {
      if (m.user) ids.add(m.user);
      if (m.text) extractSlackUserIdsFromText(m.text).forEach((id) => ids.add(id));
    }
    if (convMeta?.user) ids.add(convMeta.user);
    return [...ids];
  }, [channelMessages, threadMessages, convMeta?.user]);

  const { data: userMap = {} } = useSlackUserProfiles(slackUserIds);

  const headerLabel = useMemo(() => {
    if (notificationTitle?.trim()) {
      const t = notificationTitle.trim();
      if (t.startsWith("Slack ·")) return t.replace(/^Slack ·\s*/i, "").trim() || t;
      return t;
    }
    if (convMeta) return conversationTitle(convMeta, userMap, {});
    return channelId || "Slack";
  }, [notificationTitle, convMeta, userMap, channelId]);

  useEffect(() => {
    if (!open || !parsed) return;
    setListTab(parsed.replyTs ? "thread" : "channel");
  }, [open, parsed?.channel, parsed?.replyTs, parsed?.mainTs]);

  useEffect(() => {
    if (!open) setDraft("");
  }, [open, channelId]);

  const onChatError = (e: Error) => {
    const msg = e.message || "";
    if (isSlackPermissionDeniedMessage(msg)) {
      toast.error(SLACK_CHAT_API_PERMISSION_HINT, { duration: SLACK_PERMISSION_TOAST_MS });
      return;
    }
    toast.error(msg);
  };

  const invalidateQuickAndMain = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["slack-quick-history", channelId] });
    qc.invalidateQueries({ queryKey: ["slack-quick-thread", channelId, threadRootTs] });
    qc.invalidateQueries({ queryKey: ["slack-history", channelId], cancelRefetch: false });
    if (threadRootTs) {
      qc.invalidateQueries({ queryKey: ["slack-thread", channelId, threadRootTs] });
    }
  }, [qc, channelId, threadRootTs]);

  const composerSendMode = (): "channel" | "thread" => {
    if (hasThread && listTab === "thread") return "thread";
    return "channel";
  };

  const resolveQuickReplyUploadThreadTs = (): string | undefined => {
    if (!parsed || !hasThread) return undefined;
    return composerSendMode() === "thread" ? parsed.mainTs : undefined;
  };

  const onSlackFileUploadError = (e: Error) => {
    const msg = e.message || "";
    if (isSlackPermissionDeniedMessage(msg)) {
      toast.error(SLACK_FILE_UPLOAD_PERMISSION_HINT, { duration: SLACK_PERMISSION_TOAST_MS });
      return;
    }
    toast.error(formatSlackFileUploadError(msg), { duration: 16_000 });
  };

  const uploadMutation = useMutation({
    mutationFn: async (vars: { files: File[]; initial_comment?: string; thread_ts?: string }) => {
      const list = vars.files.filter(Boolean).slice(0, 10);
      if (list.length === 0) return;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f.size > MAX_UPLOAD_BYTES) throw new Error(`«${f.name}» supera 50 MB`);
        const form = new FormData();
        form.append("action", "files.upload");
        form.append("channel", channelId);
        form.append("filename", f.name);
        form.append("file", f);
        if (i === 0 && vars.initial_comment?.trim()) {
          form.append("initial_comment", vars.initial_comment.trim());
        }
        if (vars.thread_ts?.trim()) form.append("thread_ts", vars.thread_ts.trim());
        const data = (await invokeSlackFileUpload(form)) as { ok?: boolean; error?: string };
        if (!data.ok) throw new Error(String(data.error || "No se pudo subir el archivo"));
      }
    },
    onSuccess: (_d, vars) => {
      const n = vars.files.length;
      toast.success(n === 1 ? "Archivo enviado a Slack" : `${n} archivos enviados a Slack`);
      invalidateQuickAndMain();
    },
    onError: onSlackFileUploadError,
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { text: string; thread_ts?: string }) => {
      const data = await invokeSlackApi<{ ok: boolean; error?: string }>({
        action: "chat.postMessage",
        channel: channelId,
        text: payload.text,
        thread_ts: payload.thread_ts,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo enviar");
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.thread_ts ? "Enviado en el hilo" : "Enviado al canal");
      setDraft("");
      invalidateQuickAndMain();
    },
    onError: (e: Error) => onChatError(e),
  });

  const reactionMutation = useMutation({
    mutationFn: async (vars: {
      ts: string;
      name: string;
      add: boolean;
      navThreadRootTs?: string | null;
    }) => {
      const name = vars.name.replace(/^:|:$/g, "").trim();
      if (!channelId || !name) throw new Error("Datos incompletos");
      const action = vars.add ? "reactions.add" : "reactions.remove";
      const data = await invokeSlackApi<{ ok: boolean; error?: string }>({
        action,
        channel: channelId,
        ts: vars.ts,
        name,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo actualizar la reacción");
    },
    onSuccess: () => {
      invalidateQuickAndMain();
    },
    onError: (e, vars) => {
      const buildMessagePath = (): string | null => {
        if (!channelId) return null;
        const q = new URLSearchParams();
        q.set("channel", channelId);
        if (vars.navThreadRootTs && vars.navThreadRootTs !== vars.ts) {
          q.set("ts", vars.navThreadRootTs);
          q.set("reply", vars.ts);
        } else {
          q.set("ts", vars.ts);
        }
        return `/comunicacion?${q.toString()}`;
      };
      const path = buildMessagePath();
      const actionBtn =
        path != null
          ? ({
              label: "Ir al mensaje",
              onClick: () => navigate(path),
            } as const)
          : undefined;
      const msg = e instanceof Error ? e.message : "";
      if (isSlackPermissionDeniedMessage(msg)) {
        toast.error(SLACK_REACTIONS_PERMISSION_HINT, {
          duration: SLACK_PERMISSION_TOAST_MS,
          ...(actionBtn ? { action: actionBtn } : {}),
        });
        return;
      }
      toast.error(msg, { ...(actionBtn ? { action: actionBtn } : {}) });
    },
  });

  const navThreadRootForMessage = useCallback(
    (messageTs: string, source: ListTab): string | null => {
      if (source === "thread" && threadRootTs) return threadRootTs;
      const list = source === "channel" ? channelMessages : threadMessages;
      const msg = list.find((m) => m.ts === messageTs);
      if (msg?.thread_ts && msg.thread_ts !== msg.ts) return msg.thread_ts;
      return null;
    },
    [channelMessages, threadMessages, threadRootTs],
  );

  const handleToggleReaction = useCallback(
    (messageTs: string, name: string, add: boolean, source: ListTab) => {
      const navThreadRootTs = navThreadRootForMessage(messageTs, source);
      reactionMutation.mutate({
        ts: messageTs,
        name,
        add,
        navThreadRootTs: navThreadRootTs ?? undefined,
      });
    },
    [navThreadRootForMessage, reactionMutation],
  );

  const handleSend = (mode: "channel" | "thread") => {
    const text = draft.trim();
    if (!text || !parsed) return;
    const thread_ts = mode === "thread" ? parsed.mainTs : undefined;
    sendMutation.mutate({ text, thread_ts });
  };

  const goFullComunicacion = () => {
    if (!parsed) return;
    const path = `/comunicacion?${new URLSearchParams({
      channel: parsed.channel,
      ts: parsed.mainTs,
      ...(parsed.replyTs ? { reply: parsed.replyTs } : {}),
    }).toString()}`;
    onOpenChange(false);
    navigate(path);
  };

  const highlightChannel = parsed?.mainTs ?? "";
  const highlightThread = parsed?.replyTs ?? parsed?.mainTs ?? "";

  const channelLoading = !historyQuery.data && historyQuery.fetchStatus === "fetching";
  const channelError = historyQuery.error as Error | null;
  const threadLoading = !threadQuery.data && threadQuery.fetchStatus === "fetching";
  const threadError = threadQuery.error as Error | null;

  const reactionPending =
    reactionMutation.isPending && reactionMutation.variables
      ? {
          messageTs: reactionMutation.variables.ts,
          name: reactionMutation.variables.name,
        }
      : null;

  if (!parsed) return null;

  const messageListShell = "flex flex-1 min-h-0 flex-col overflow-hidden bg-muted/15";

  const renderChannelList = () => (
    <div className={messageListShell}>
      <SlackMessageList
        messages={channelMessages}
        userMap={userMap}
        highlightTs={highlightChannel}
        isLoading={channelLoading}
        error={channelError}
        hasMore={false}
        isFetchingMore={false}
        slackReactionChannelId={channelId}
        slackSelfUserId={connection?.slack_user_id ?? null}
        reactionPending={reactionPending}
        onToggleReaction={(ts, name, add) => handleToggleReaction(ts, name, add, "channel")}
        selectedChannelId={channelId}
        currentChannelName={headerLabel}
      />
    </div>
  );

  const renderThreadList = () => (
    <div className={messageListShell}>
      <SlackMessageList
        messages={threadMessages}
        userMap={userMap}
        highlightTs={highlightThread}
        isLoading={threadLoading}
        error={threadError}
        hasMore={false}
        isFetchingMore={false}
        slackReactionChannelId={channelId}
        slackSelfUserId={connection?.slack_user_id ?? null}
        reactionPending={reactionPending}
        onToggleReaction={(ts, name, add) => handleToggleReaction(ts, name, add, "thread")}
        selectedChannelId={channelId}
        currentChannelName={headerLabel}
      />
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 bg-background p-0 sm:max-w-[480px]"
        aria-describedby={undefined}
      >
        <SheetHeader className="space-y-1 border-b border-border/80 bg-background px-4 py-3 pr-12 text-left shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-[#611f69] shrink-0" />
            <span className="truncate">{headerLabel}</span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Contexto reciente del canal (~48h) y, si aplica, el hilo del aviso. Mismo estilo que Comunicación.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {!isConnected && !loadingConn && (
            <Alert className="m-3 shrink-0">
              <AlertTitle className="text-sm">Slack no conectado</AlertTitle>
              <AlertDescription className="text-xs">
                Conecta tu cuenta en Comunicación para responder desde aquí.
              </AlertDescription>
            </Alert>
          )}

          {loadingConn && (
            <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {isConnected && (
            <SlackChatFileDropZone
              enabled={!!channelId && !uploadMutation.isPending}
              busy={uploadMutation.isPending}
              onDroppedFileList={(files) =>
                quickComposerRef.current?.addFilesFromDrop(files) ?? Promise.resolve()
              }
              className="flex flex-1 min-h-0 flex-col overflow-hidden"
            >
              <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                {hasThread ? (
                  <Tabs
                    value={listTab}
                    onValueChange={(v) => setListTab(v as ListTab)}
                    className="flex flex-1 min-h-0 flex-col gap-0"
                  >
                    <TabsList className="mx-3 mt-2 h-9 shrink-0 w-fit self-start">
                      <TabsTrigger value="channel" className="text-xs px-3">
                        Canal
                      </TabsTrigger>
                      <TabsTrigger value="thread" className="text-xs px-3">
                        Hilo
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent
                      value="channel"
                      className={cn(
                        "mt-2 flex-1 min-h-0 flex flex-col overflow-hidden data-[state=inactive]:hidden",
                      )}
                    >
                      {renderChannelList()}
                    </TabsContent>
                    <TabsContent
                      value="thread"
                      className={cn(
                        "mt-2 flex-1 min-h-0 flex flex-col overflow-hidden data-[state=inactive]:hidden",
                      )}
                    >
                      {renderThreadList()}
                    </TabsContent>
                  </Tabs>
                ) : (
                  <div className="flex flex-1 min-h-0 flex-col pt-2">{renderChannelList()}</div>
                )}

                <div className="shrink-0 border-t border-border/80 bg-muted/25 p-3 space-y-2">
                  <SlackComposer
                    ref={quickComposerRef}
                    key={`${channelId}-${listTab}`}
                    value={draft}
                    onChange={setDraft}
                    onSend={() => handleSend(composerSendMode())}
                    disabled={!channelId}
                    sending={sendMutation.isPending || uploadMutation.isPending}
                    channelLabel={headerLabel}
                    mentionUserIds={[]}
                    userMap={userMap}
                    compact
                    onUploadFiles={(files, initial_comment) =>
                      uploadMutation.mutateAsync({
                        files,
                        initial_comment,
                        thread_ts: resolveQuickReplyUploadThreadTs(),
                      })
                    }
                    uploading={uploadMutation.isPending}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1 min-w-[7rem]"
                      disabled={
                        sendMutation.isPending ||
                        uploadMutation.isPending ||
                        !draft.trim()
                      }
                      onClick={() => handleSend("channel")}
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "En canal"
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="flex-1 min-w-[7rem]"
                      disabled={
                        sendMutation.isPending ||
                        uploadMutation.isPending ||
                        !draft.trim()
                      }
                      onClick={() => handleSend("thread")}
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "En hilo"
                      )}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Los adjuntos se muestran arriba y se envían con Enter (o el botón de enviar). ⌘/Ctrl+Enter sigue el modo
                    de la pestaña; los botones fuerzan canal o hilo solo para texto.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={goFullComunicacion}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir en Comunicación
                  </Button>
                </div>
              </div>
            </SlackChatFileDropZone>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
