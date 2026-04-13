import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, MessageSquareText, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SlackMessage } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { slackUserDisplayName } from "./slackGrouping";
import { cn } from "@/lib/utils";
import {
  formatDaySeparatorLabel,
  formatSlackMessageTime,
  formatSlackTooltipFull,
  isSlackSystemSubtype,
  sameSlackDay,
  slackMrkdwnToReact,
  slackSystemMessageLabel,
  slackTsToMs,
  type FormatContext,
} from "@/lib/slackFormatting";
import { SLACK_EMOJI } from "@/lib/slackFormatting";

type Props = {
  messages: SlackMessage[];
  userMap: Record<string, SlackUserProfile | undefined>;
  highlightTs: string;
  isLoading: boolean;
  error: Error | null;
  bottomRef?: RefObject<HTMLDivElement | null>;
  /** Carga más mensajes antiguos al acercarse al tope. */
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
  onOpenThread?: (threadTs: string) => void;
  /** Mensaje raíz cuyo hilo está abierto en el panel (resalta en el canal). */
  activeThreadRootTs?: string | null;
  selectedChannelId: string;
};

/** Timestamp raíz del hilo para API y UI (mensaje padre o broadcast en canal). */
function slackThreadRootTs(m: SlackMessage): string {
  return m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : m.thread_ts || m.ts;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function reactionLabel(name: string): string {
  const k = name.replace(/^::|::$/g, "").toLowerCase();
  return SLACK_EMOJI[k] || `:${name}:`;
}

function FileAttachmentPreview({ f }: { f: NonNullable<SlackMessage["files"]>[number] }) {
  const isImg = f.mimetype?.startsWith("image/");
  const label = f.title || f.name || "Archivo";
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {isImg && f.thumb_360 ? (
        <a
          href={f.permalink || f.url_private}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md border border-border/60 overflow-hidden max-w-[220px]"
        >
          <img src={f.thumb_360} alt="" className="max-h-40 w-auto object-cover" />
        </a>
      ) : (
        <a
          href={f.permalink || f.url_private}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5 text-xs hover:bg-muted/50"
        >
          <span className="font-medium truncate max-w-[200px]">{label}</span>
          {f.size != null && <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>}
        </a>
      )}
    </div>
  );
}

export function SlackMessageList({
  messages,
  userMap,
  highlightTs,
  isLoading,
  error,
  bottomRef,
  hasMore,
  isFetchingMore,
  onLoadMore,
  onOpenThread,
  activeThreadRootTs = null,
  selectedChannelId,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mentionUserId, setMentionUserId] = useState<string | null>(null);
  const prevLenRef = useRef(0);
  const stickBottomRef = useRef(true);

  const formatCtx: FormatContext = {
    userMap,
    onUserMentionClick: (id) => setMentionUserId(id),
  };

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (!messages.length || highlightTs) return;
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length !== prevLenRef.current) {
      if (stickBottomRef.current || messages.length <= prevLenRef.current) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
      prevLenRef.current = messages.length;
    }
  }, [messages.length, messages, highlightTs]);

  useEffect(() => {
    prevLenRef.current = 0;
    stickBottomRef.current = true;
  }, [selectedChannelId]);

  useLayoutEffect(() => {
    stickBottomRef.current = true;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [selectedChannelId]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = dist < 80;
    if (el.scrollTop < 120 && hasMore && !isFetchingMore && onLoadMore) {
      const prevH = el.scrollHeight;
      onLoadMore();
      requestAnimationFrame(() => {
        const newEl = scrollRef.current;
        if (newEl) newEl.scrollTop = newEl.scrollHeight - prevH;
      });
    }
  }, [hasMore, isFetchingMore, onLoadMore]);

  useEffect(() => {
    if (!highlightTs || !messages.length) return;
    const idSafe = highlightTs.replace(/\./g, "-");
    const t = setTimeout(() => {
      document.getElementById(`slack-msg-${idSafe}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
    return () => clearTimeout(t);
  }, [highlightTs, messages.length]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[200px]">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error.message}</div>;
  }

  let prevTs: string | undefined;

  const rows: ReactNode[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const idSafe = m.ts.replace(/\./g, "-");
    const highlight = highlightTs && m.ts === highlightTs;
    const uid = m.user;
    const label = m.bot_id ? "Bot" : slackUserDisplayName(uid, userMap);
    const prof = uid ? userMap[uid] : undefined;
    const av = prof?.avatar_url;

    if (prevTs && !sameSlackDay(prevTs, m.ts)) {
      rows.push(
        <div key={`day-${m.ts}`} className="flex justify-center my-4">
          <span className="text-[11px] font-medium text-muted-foreground bg-muted/60 px-3 py-1 rounded-full">
            {formatDaySeparatorLabel(m.ts)}
          </span>
        </div>,
      );
    }

    if (isSlackSystemSubtype(m.subtype)) {
      rows.push(
        <div
          key={m.ts}
          id={`slack-msg-${idSafe}`}
          className={cn(
            "flex justify-center px-4 py-1 text-center text-xs text-muted-foreground",
            highlight && "bg-primary/[0.08] rounded-md",
          )}
        >
          <span className="inline-flex items-center gap-1.5 max-w-lg">
            <UserPlus className="h-3 w-3 shrink-0 opacity-70" />
            {slackMrkdwnToReact(slackSystemMessageLabel(m), formatCtx) || slackSystemMessageLabel(m)}
          </span>
        </div>,
      );
      prevTs = m.ts;
      continue;
    }

    const prevMsg = i > 0 ? messages[i - 1] : undefined;
    const group =
      prevMsg &&
      !isSlackSystemSubtype(prevMsg.subtype) &&
      !isSlackSystemSubtype(m.subtype) &&
      prevMsg.user === uid &&
      uid &&
      slackTsToMs(m.ts) - slackTsToMs(prevMsg.ts) < 5 * 60 * 1000;

    const showHeader = !group;

    const bodyText = m.text?.trim();
    const hasFiles = (m.files?.length ?? 0) > 0;

    const rootTs = slackThreadRootTs(m);
    const threadActiveHere = !!activeThreadRootTs && activeThreadRootTs === rootTs;
    const hasThreadActivity = (m.reply_count ?? 0) > 0 || threadActiveHere;

    rows.push(
      <div
        key={m.ts}
        id={`slack-msg-${idSafe}`}
        className={cn(
          "group flex gap-3 rounded-lg px-2 py-0.5 -mx-2 transition-colors",
          showHeader ? "pt-1.5" : "pt-0",
          highlight ? "bg-primary/[0.08] ring-1 ring-primary/20" : "hover:bg-muted/40",
          hasThreadActivity && "border-l-2 border-[#611f69]/45 pl-2 -ml-0.5 rounded-l-md bg-muted/20",
          threadActiveHere && "ring-1 ring-[#611f69]/30",
        )}
      >
        {showHeader ? (
          <Avatar className="h-9 w-9 shrink-0 mt-0.5">
            {av ? <AvatarImage src={av} alt="" /> : null}
            <AvatarFallback className="text-[10px] bg-secondary text-secondary-foreground">
              {initials(label)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className="w-9 shrink-0 flex justify-end pr-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground/0 group-hover:text-muted-foreground/80 tabular-nums cursor-default pt-1">
                    {formatSlackMessageTime(m.ts).split(" ").pop()}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">{formatSlackTooltipFull(m.ts)}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        <div className="min-w-0 flex-1">
          {showHeader && (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] text-muted-foreground tabular-nums cursor-default">
                      {formatSlackMessageTime(m.ts)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{formatSlackTooltipFull(m.ts)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          <div className="text-sm text-foreground/95 whitespace-pre-wrap break-words leading-relaxed mt-0.5">
            {bodyText ? slackMrkdwnToReact(bodyText, formatCtx) : null}
            {m.files?.map((f) => (
              <FileAttachmentPreview key={f.id || f.name} f={f} />
            ))}
            {!bodyText && !hasFiles && (
              <span className="text-muted-foreground italic text-xs">Sin texto ni adjuntos</span>
            )}
          </div>
          {m.reactions && m.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {m.reactions.map((r) => (
                <span
                  key={r.name}
                  className="inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px]"
                  title={r.users?.join(", ")}
                >
                  <span>{reactionLabel(r.name)}</span>
                  <span className="text-muted-foreground">{r.count}</span>
                </span>
              ))}
            </div>
          )}
          {onOpenThread && (
            <Button
              type="button"
              variant={threadActiveHere ? "default" : "secondary"}
              size="sm"
              className={cn(
                "mt-1.5 h-7 gap-1.5 text-xs font-medium shrink-0",
                threadActiveHere && "bg-[#611f69] hover:bg-[#4a154b]",
              )}
              onClick={() => onOpenThread(rootTs)}
            >
              <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
              {(m.reply_count ?? 0) > 0
                ? `${m.reply_count} en el hilo`
                : threadActiveHere
                  ? "Hilo abierto"
                  : "Responder en hilo"}
            </Button>
          )}
        </div>
      </div>,
    );

    prevTs = m.ts;
  }

  const profileOpen = mentionUserId ? userMap[mentionUserId] : undefined;

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]"
      >
        <div className="px-3 py-4 space-y-1 max-w-4xl mx-auto">
          {isFetchingMore && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {rows}
          {bottomRef && <div ref={bottomRef} className="h-2" />}
        </div>
      </div>
      <Dialog open={!!mentionUserId} onOpenChange={(o) => !o && setMentionUserId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Usuario Slack</DialogTitle>
          </DialogHeader>
          {mentionUserId && (
            <div className="flex gap-3 pt-1">
              <Avatar className="h-11 w-11">
                {profileOpen?.avatar_url ? <AvatarImage src={profileOpen.avatar_url} alt="" /> : null}
                <AvatarFallback>{initials(slackUserDisplayName(mentionUserId, userMap))}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{slackUserDisplayName(mentionUserId, userMap)}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{mentionUserId}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
