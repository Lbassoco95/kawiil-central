import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SlackDeepLinkPartsCompat } from "@/lib/slackDeepLink";
import {
  invokeSlackApi,
  formatSlackHistoryLoadError,
  isSlackPermissionDeniedMessage,
  SLACK_CHAT_API_PERMISSION_HINT,
  SLACK_PERMISSION_TOAST_MS,
  type SlackConversation,
  type SlackMessage,
} from "@/lib/slackApi";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { extractSlackUserIdsFromText } from "@/lib/slackFormatting";
import { conversationTitle, slackUserDisplayName } from "@/components/slack/slackGrouping";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const HISTORY_LIMIT = 50;
const THREAD_LIMIT = 50;
const WINDOW_SEC = 48 * 3600;

const MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;

function slackWindowOldestTs(): string {
  return (Date.now() / 1000 - WINDOW_SEC).toFixed(6);
}

function plainSlackText(
  text: string | null | undefined,
  userMap: Record<string, { display_name: string | null; real_name: string | null } | undefined>,
): string {
  if (!text) return "";
  let out = text.replace(MENTION_RE, (_m, id: string) => `@${slackUserDisplayName(id, userMap)}`);
  out = out.replace(/<((?:https?:\/\/|mailto:)[^|>\s]+)\|([^>]+)>/g, "$2");
  out = out.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1");
  out = out.replace(/<#[CG][A-Z0-9]+\|([^>]+)>/g, "#$1");
  out = out.replace(/<!subteam\^[A-Z0-9]+\|@?([^>]+)>/g, "@$1");
  out = out.replace(/<!(channel|here|everyone)>/g, "@$1");
  return out.trim();
}

function sortMessagesAsc(messages: SlackMessage[]): SlackMessage[] {
  return [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
}

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
  const { isConnected, isLoading: loadingConn } = useSlackConnection();
  const [draft, setDraft] = useState("");

  const channelId = parsed?.channel ?? "";

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
    // Tras `conversations.info` (misma tasa de API al abrir: menos ráfagas concurrentes).
    enabled:
      open &&
      isConnected &&
      !!channelId &&
      !parsed?.replyTs &&
      (channelQuery.isSuccess || channelQuery.isError),
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
    enabled: open && isConnected && !!channelId && !!parsed?.replyTs,
    staleTime: 15_000,
  });

  const displayMessages = parsed?.replyTs ? threadQuery.data ?? [] : historyQuery.data ?? [];

  const slackUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of displayMessages) {
      if (m.user) ids.add(m.user);
      if (m.text) extractSlackUserIdsFromText(m.text).forEach((id) => ids.add(id));
    }
    if (convMeta?.user) ids.add(convMeta.user);
    return [...ids];
  }, [displayMessages, convMeta?.user]);

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

  const loadingMessages = parsed?.replyTs ? threadQuery.isLoading : historyQuery.isLoading;
  const messagesError = parsed?.replyTs ? threadQuery.error : historyQuery.error;

  const highlightTs = parsed?.replyTs ?? parsed?.mainTs;

  useEffect(() => {
    if (!open || !highlightTs || loadingMessages) return;
    const id = `slack-quick-msg-${highlightTs.replace(/\./g, "-")}`;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [open, highlightTs, loadingMessages, displayMessages.length]);

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
      qc.invalidateQueries({ queryKey: ["slack-quick-history", channelId] });
      qc.invalidateQueries({ queryKey: ["slack-quick-thread", channelId, parsed?.mainTs] });
      qc.invalidateQueries({ queryKey: ["slack-history", channelId] });
      if (vars.thread_ts) {
        qc.invalidateQueries({ queryKey: ["slack-thread", channelId, vars.thread_ts] });
      }
    },
    onError: (e: Error) => onChatError(e),
  });

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

  if (!parsed) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[440px]"
        aria-describedby={undefined}
      >
        <SheetHeader className="space-y-1 border-b border-border/80 px-4 py-3 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <span className="truncate">{headerLabel}</span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Contexto reciente (~48h en canal, o mensajes del hilo). Sin cargar historial completo.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col min-h-0">
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
            <>
              <div className="flex-1 min-h-[200px] max-h-[min(52vh,420px)] overflow-y-auto px-3 py-2 space-y-2">
                {loadingMessages && (
                  <div className="flex justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}
                {messagesError && (
                  <Alert variant="destructive">
                    <AlertTitle className="text-sm">No se pudo cargar</AlertTitle>
                    <AlertDescription className="text-xs">
                      {(messagesError as Error).message}
                    </AlertDescription>
                  </Alert>
                )}
                {!loadingMessages && !messagesError && displayMessages.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    No hay mensajes en esta ventana. Abre Comunicación para ver el historial completo.
                  </p>
                )}
                {!loadingMessages &&
                  displayMessages.map((m) => {
                    const plain = plainSlackText(m.text, userMap);
                    if (!plain && !m.files?.length) return null;
                    const author = m.user
                      ? slackUserDisplayName(m.user, userMap)
                      : m.bot_id
                        ? "Bot"
                        : "Usuario";
                    const isHi = m.ts === highlightTs;
                    return (
                      <div
                        key={m.ts}
                        id={`slack-quick-msg-${m.ts.replace(/\./g, "-")}`}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-xs",
                          isHi
                            ? "border-sky-500/60 bg-sky-500/10"
                            : "border-border/60 bg-card/80",
                        )}
                      >
                        <div className="font-semibold text-[11px] text-foreground/90">{author}</div>
                        {plain ? (
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">
                            {plain}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
              </div>

              <div className="shrink-0 border-t border-border/80 p-3 space-y-2 bg-muted/20">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escribe una respuesta…"
                  className="min-h-[72px] max-h-[120px] text-sm resize-none"
                  disabled={sendMutation.isPending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSend(parsed.replyTs ? "thread" : "channel");
                    }
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 min-w-[7rem]"
                    disabled={sendMutation.isPending || !draft.trim()}
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
                    disabled={sendMutation.isPending || !draft.trim()}
                    onClick={() => handleSend("thread")}
                  >
                    En hilo
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  ⌘/Ctrl+Enter envía al canal (o al hilo si el aviso era de un hilo).
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
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
