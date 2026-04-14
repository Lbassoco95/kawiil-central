import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2 } from "lucide-react";
import { invokeSlackApi, type SlackMessage } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { SlackComposer } from "./SlackComposer";
import { SlackMessageList } from "./SlackMessageList";
import { useState } from "react";

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
}: Props) {
  const [draft, setDraft] = useState("");

  const threadQuery = useQuery({
    queryKey: ["slack-thread", channelId, threadTs],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const data = await invokeSlackApi<{ ok: boolean; messages?: SlackMessage[]; error?: string }>({
        action: "conversations.replies",
        channel: channelId,
        ts: threadTs!,
        limit: 80,
      });
      if (!data.ok) throw new Error(data.error || "No se pudo cargar el hilo");
      return data.messages || [];
    },
    enabled: open && !!channelId && !!threadTs,
  });

  const messages = threadQuery.data || [];
  const parent = messages[0];
  const replies = messages.slice(1);

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
                highlightTs=""
                isLoading={false}
                error={threadQuery.error as Error | null}
                selectedChannelId={`${channelId}-thread`}
                hasMore={false}
                slackReactionChannelId={channelId}
                slackSelfUserId={slackSelfUserId}
                reactionPending={reactionPending}
                onToggleReaction={onToggleReaction}
                onCreateTaskFromMessage={onCreateTaskFromMessage}
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
              compact
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
