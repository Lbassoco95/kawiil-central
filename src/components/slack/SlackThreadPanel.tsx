import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { invokeSlackApi, withHardTimeout, formatSlackHistoryLoadError, type SlackMessage } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { SlackComposer } from "./SlackComposer";
import { SlackMessageList } from "./SlackMessageList";
import { SlackChatFileDropZone } from "./SlackChatFileDropZone";
import { useEffect, useMemo, useState } from "react";

/** Alineado con Comunicación: primera carga puede encadenar varias llamadas en la edge. */
const SLACK_THREAD_FIRST_INVOKE_MS = 110_000;
const SLACK_THREAD_FIRST_HARD_MS = 118_000;
const SLACK_THREAD_RETRY_INVOKE_MS = 90_000;
const SLACK_THREAD_RETRY_HARD_MS = 96_000;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  threadTs: string | null;
  userMap: Record<string, SlackUserProfile | undefined>;
  onReply: (text: string) => void;
  sending: boolean;
  slackSelfUserId?: string | null;
  reactionPending?: { messageTs: string; name: string } | null;
  onToggleReaction?: (messageTs: string, emojiName: string, add: boolean) => void;
  onCreateTaskFromMessage?: (message: SlackMessage) => void;
  /** IDs Slack de usuarios que pueden arrobarse dentro del hilo (mismos miembros del canal). */
  mentionUserIds?: string[];
  /** Resaltar una respuesta concreta (p. ej. deep link desde notificación). */
  highlightReplyTs?: string | null;
  onEditSlackMessage?: (ts: string, text: string) => void;
  onDeleteSlackMessage?: (ts: string) => void;
  slackMessageActionPending?: boolean;
  onUploadThreadFiles?: (files: File[], initialComment?: string) => void | Promise<void>;
  uploadingThreadFile?: boolean;
  onScheduleThreadMessage?: (postAtUnixSeconds: number, text: string) => Promise<void>;
  schedulingThreadMessage?: boolean;
  onImproveThreadDraft?: (
    draft: string,
    mode: "improve" | "shorter" | "formal" | "friendly",
  ) => Promise<string>;
};

export function SlackThreadPanel({
  open,
  onOpenChange,
  channelId,
  threadTs,
  userMap,
  onReply,
  sending,
  slackSelfUserId = null,
  reactionPending = null,
  onToggleReaction,
  onCreateTaskFromMessage,
  mentionUserIds,
  highlightReplyTs = null,
  onEditSlackMessage,
  onDeleteSlackMessage,
  slackMessageActionPending = false,
  onUploadThreadFiles,
  uploadingThreadFile = false,
  onScheduleThreadMessage,
  schedulingThreadMessage = false,
  onImproveThreadDraft,
}: Props) {
  const [draft, setDraft] = useState("");
  const [threadLoadSlow, setThreadLoadSlow] = useState(false);

  const threadQuery = useQuery({
    queryKey: ["slack-thread", channelId, threadTs],
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const payload = {
        action: "conversations.replies" as const,
        channel: channelId,
        ts: threadTs!,
        limit: 1000,
      };
      try {
        const data = await withHardTimeout(
          invokeSlackApi<{ ok: boolean; messages?: SlackMessage[]; error?: string }>(payload, {
            signal,
            timeoutMs: SLACK_THREAD_FIRST_INVOKE_MS,
          }),
          SLACK_THREAD_FIRST_HARD_MS,
          "La carga del hilo tardó demasiado. Vuelve a abrir el hilo.",
        );
        if (!data.ok) throw new Error(formatSlackHistoryLoadError(data.error));
        return data.messages || [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("se canceló") && !msg.includes("tardó demasiado")) {
          const data = await withHardTimeout(
            invokeSlackApi<{ ok: boolean; messages?: SlackMessage[]; error?: string }>(payload, {
              timeoutMs: SLACK_THREAD_RETRY_INVOKE_MS,
            }),
            SLACK_THREAD_RETRY_HARD_MS,
            "La recarga del hilo tardó demasiado. Vuelve a abrir el hilo.",
          );
          if (!data.ok) throw new Error(formatSlackHistoryLoadError(data.error));
          return data.messages || [];
        }
        throw e;
      }
    },
    retry(failureCount, err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("tardó demasiado") || msg.includes("se canceló")) return false;
      return failureCount < 2;
    },
    enabled: open && !!channelId && !!threadTs,
    refetchInterval: (query) => {
      if (typeof document === "undefined") return false;
      if (document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      return 30_000;
    },
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const fetching = threadQuery.isFetching && !threadQuery.data;
    if (!fetching) {
      setThreadLoadSlow(false);
      return;
    }
    const t = setTimeout(() => setThreadLoadSlow(true), 12_000);
    return () => clearTimeout(t);
  }, [threadQuery.isFetching, threadQuery.data]);

  const threadData = threadQuery.data;
  const messages = threadData ?? [];
  const parent = messages[0];
  const replies = messages.slice(1);

  /**
   * Lista de IDs arrobables dentro del hilo. Si `mentionUserIds` viene del
   * contenedor (p. ej. miembros del canal en `Comunicacion`), la usamos;
   * si no, caemos al conjunto de autores del hilo para que el popover
   * siempre tenga candidatos reales.
   */
  const effectiveMentionIds = useMemo(() => {
    if (mentionUserIds && mentionUserIds.length > 0) return mentionUserIds;
    const msgList = threadData ?? [];
    const set = new Set<string>();
    for (const m of msgList) {
      if (m.user) set.add(m.user);
      for (const id of m.reply_users ?? []) set.add(id);
    }
    for (const id of Object.keys(userMap)) set.add(id);
    return [...set];
  }, [mentionUserIds, threadData, userMap]);

  const threadColumnClass = "flex-1 min-h-0 flex flex-col";
  const threadMainColumn = (
    <>
      {threadQuery.isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 gap-4">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          {threadLoadSlow && (
            <div className="text-center space-y-2 max-w-xs">
              <p className="text-xs text-muted-foreground">
                Slack está tardando en cargar el hilo. Puedes reintentar o comprobar la conexión.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => threadQuery.refetch()}>
                Reintentar
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <SlackMessageList
            messages={replies}
            userMap={userMap}
            highlightTs={highlightReplyTs?.trim() || ""}
            isLoading={false}
            error={threadQuery.error as Error | null}
            selectedChannelId={`${channelId}-thread-${threadTs}`}
            hasMore={false}
            slackReactionChannelId={channelId}
            slackSelfUserId={slackSelfUserId}
            reactionPending={reactionPending}
            onToggleReaction={onToggleReaction}
            onCreateTaskFromMessage={onCreateTaskFromMessage}
            onEditSlackMessage={onEditSlackMessage}
            onDeleteSlackMessage={onDeleteSlackMessage}
            slackMessageActionPending={slackMessageActionPending}
          />
        </div>
      )}
      <div className="shrink-0 border-t bg-background">
        <SlackComposer
          value={draft}
          onChange={setDraft}
          onSend={() => {
            const t = draft.trim();
            if (!t) return;
            onReply(t);
            setDraft("");
          }}
          disabled={!threadTs}
          sending={sending}
          channelLabel="respuesta en hilo"
          mentionUserIds={effectiveMentionIds}
          userMap={userMap}
          compact
          onUploadFiles={onUploadThreadFiles}
          uploading={uploadingThreadFile}
          onSchedule={
            onScheduleThreadMessage
              ? async (postAt, text) => {
                  await onScheduleThreadMessage(postAt, text);
                  setDraft("");
                }
              : undefined
          }
          scheduling={schedulingThreadMessage}
          onImproveWithAi={onImproveThreadDraft}
        />
      </div>
    </>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="px-4 py-3 border-b shrink-0 text-left space-y-1">
          <SheetTitle className="text-base">Hilo</SheetTitle>
          {parent?.text && (
            <p className="text-xs text-muted-foreground line-clamp-3 font-normal">{parent.text}</p>
          )}
        </SheetHeader>
        {onUploadThreadFiles ? (
          <SlackChatFileDropZone
            enabled={open && !!threadTs && !uploadingThreadFile}
            busy={uploadingThreadFile}
            onFiles={(files) => void onUploadThreadFiles(files, draft.trim() || undefined)}
            className={threadColumnClass}
          >
            {threadMainColumn}
          </SlackChatFileDropZone>
        ) : (
          <div className={threadColumnClass}>{threadMainColumn}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
