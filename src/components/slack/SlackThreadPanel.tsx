import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2 } from "lucide-react";
import { invokeSlackApi, type SlackMessage } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { SlackComposer } from "./SlackComposer";
import { SlackMessageList } from "./SlackMessageList";
import { useMemo, useState } from "react";

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
  onUploadThreadFile?: (file: File, initialComment?: string) => void;
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
  onUploadThreadFile,
  uploadingThreadFile = false,
  onScheduleThreadMessage,
  schedulingThreadMessage = false,
  onImproveThreadDraft,
}: Props) {
  const [draft, setDraft] = useState("");

  const threadQuery = useQuery({
    queryKey: ["slack-thread", channelId, threadTs],
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const data = await invokeSlackApi<{ ok: boolean; messages?: SlackMessage[]; error?: string }>(
        {
          action: "conversations.replies",
          channel: channelId,
          ts: threadTs!,
          limit: 1000,
        },
        { signal, timeoutMs: 55_000 },
      );
      if (!data.ok) throw new Error(data.error || "No se pudo cargar el hilo");
      return data.messages || [];
    },
    enabled: open && !!channelId && !!threadTs,
    refetchInterval: () =>
      typeof document !== "undefined" && document.visibilityState === "visible" ? 18_000 : false,
    refetchIntervalInBackground: false,
  });

  const messages = threadQuery.data || [];
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
    const set = new Set<string>();
    for (const m of messages) {
      if (m.user) set.add(m.user);
      for (const id of m.reply_users ?? []) set.add(id);
    }
    for (const id of Object.keys(userMap)) set.add(id);
    return [...set];
  }, [mentionUserIds, messages, userMap]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="px-4 py-3 border-b shrink-0 text-left space-y-1">
          <SheetTitle className="text-base">Hilo</SheetTitle>
          {parent?.text && (
            <p className="text-xs text-muted-foreground line-clamp-3 font-normal">{parent.text}</p>
          )}
        </SheetHeader>
        <div className="flex-1 min-h-0 flex flex-col">
          {threadQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
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
              onUploadFile={onUploadThreadFile}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
