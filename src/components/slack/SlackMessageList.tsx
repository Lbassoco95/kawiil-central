import { RefObject } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2 } from "lucide-react";
import type { SlackMessage } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { slackUserDisplayName } from "./slackGrouping";
import { cn } from "@/lib/utils";

type Props = {
  messages: SlackMessage[];
  userMap: Record<string, SlackUserProfile | undefined>;
  highlightTs: string;
  isLoading: boolean;
  error: Error | null;
  bottomRef?: RefObject<HTMLDivElement | null>;
};

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export function SlackMessageList({ messages, userMap, highlightTs, isLoading, error, bottomRef }: Props) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[200px]">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">{error.message}</div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="px-3 py-4 space-y-1 max-w-4xl mx-auto">
        {messages.map((m) => {
          const idSafe = m.ts.replace(/\./g, "-");
          const highlight = highlightTs && m.ts === highlightTs;
          const uid = m.user;
          const label = m.bot_id ? "Bot" : slackUserDisplayName(uid, userMap);
          const prof = uid ? userMap[uid] : undefined;
          const av = prof?.avatar_url;

          return (
            <div
              key={m.ts}
              id={`slack-msg-${idSafe}`}
              className={cn(
                "group flex gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-colors",
                highlight ? "bg-primary/[0.08] ring-1 ring-primary/20" : "hover:bg-muted/40",
              )}
            >
              <Avatar className="h-9 w-9 shrink-0 mt-0.5">
                {av ? <AvatarImage src={av} alt="" /> : null}
                <AvatarFallback className="text-[10px] bg-secondary text-secondary-foreground">
                  {initials(label)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{m.ts}</span>
                </div>
                <div className="text-sm text-foreground/95 whitespace-pre-wrap break-words leading-relaxed mt-0.5">
                  {m.text || <span className="text-muted-foreground italic">(sin texto)</span>}
                </div>
              </div>
            </div>
          );
        })}
        {bottomRef && <div ref={bottomRef} className="h-2" />}
      </div>
    </ScrollArea>
  );
}
