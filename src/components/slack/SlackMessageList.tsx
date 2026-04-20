import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ClipboardPlus, Download, FileText, Loader2, MessageSquareText, Smile, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fetchSlackPrivateFileBlob, type SlackMessage } from "@/lib/slackApi";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
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
  slackEmojiAliasToChar,
  slackTsToMs,
  type FormatContext,
} from "@/lib/slackFormatting";
import { SLACK_EMOJI } from "@/lib/slackFormatting";
import { SlackSaveForLaterButton } from "@/components/slack/SlackSaveForLaterButton";

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
  /** Canal real de Slack para reactions.add/remove (p. ej. mismo que la conversación). */
  slackReactionChannelId?: string | null;
  slackSelfUserId?: string | null;
  reactionPending?: { messageTs: string; name: string } | null;
  onToggleReaction?: (messageTs: string, emojiName: string, add: boolean) => void;
  selectedChannelId: string;
  onCreateTaskFromMessage?: (message: SlackMessage) => void;
  /** Set de keys `channel|ts` de mensajes guardados en "Más tarde". */
  savedMessageKeys?: Set<string>;
  /** Etiqueta amable del canal actual para persistir con el guardado. */
  currentChannelName?: string | null;
};

const REACTION_PICKER_KEYS = [
  "thumbsup",
  "heart",
  "joy",
  "clap",
  "fire",
  "eyes",
  "thinking_face",
  "white_check_mark",
  "rocket",
  "pray",
  "raised_hands",
  "tada",
  "memo",
  "warning",
  "hugging_face",
  "smile",
  "clipboard",
  "ok_hand",
  "wave",
].filter((k) => k in SLACK_EMOJI);

/** Timestamp raíz del hilo para API y UI (mensaje padre o broadcast en canal). */
function slackThreadRootTs(m: SlackMessage): string {
  return m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : m.thread_ts || m.ts;
}

function reactionLabel(name: string): string {
  const k = name.replace(/^::|::$/g, "").replace(/^:|:$/g, "").toLowerCase();
  return slackEmojiAliasToChar(k);
}

function slackReactionNamesMatch(a: string, b: string): boolean {
  const na = a.replace(/^:|:$/g, "").toLowerCase();
  const nb = b.replace(/^:|:$/g, "").toLowerCase();
  if (na === nb) return true;
  if ((na === "thumbsup" && nb === "+1") || (na === "+1" && nb === "thumbsup")) return true;
  return false;
}

function formatFileSize(size: number | undefined): string | null {
  if (size == null || !Number.isFinite(size)) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function FileAttachmentPreview({ f }: { f: NonNullable<SlackMessage["files"]>[number] }) {
  const isImg = f.mimetype?.startsWith("image/");
  const label = f.title || f.name || "Archivo";
  const privateUrl = f.url_private_download || f.url_private || "";
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const resolvePrivateUrl = useCallback(async (): Promise<string | null> => {
    if (resolvedUrl) return resolvedUrl;
    if (!privateUrl) return null;
    setLoading(true);
    try {
      const blob = await fetchSlackPrivateFileBlob(privateUrl);
      const nextUrl = URL.createObjectURL(blob);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      objectUrlRef.current = nextUrl;
      setResolvedUrl(nextUrl);
      return nextUrl;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [privateUrl, resolvedUrl]);

  // Lazy-load: solo bajamos el blob cuando el adjunto entra a la vista.
  // Evita descargar decenas de imágenes en paralelo al abrir una conversación (OOM en Chrome).
  useEffect(() => {
    if (!isImg || !privateUrl) return;
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isImg, privateUrl]);

  useEffect(() => {
    if (!isImg || !privateUrl || !isVisible || resolvedUrl) return;
    void resolvePrivateUrl();
  }, [isImg, privateUrl, isVisible, resolvedUrl, resolvePrivateUrl]);

  const openAttachment = useCallback(async () => {
    const next = (await resolvePrivateUrl()) || f.permalink || privateUrl;
    if (!next) return;
    window.open(next, "_blank", "noopener,noreferrer");
  }, [resolvePrivateUrl, f.permalink, privateUrl]);

  const downloadAttachment = useCallback(async () => {
    const next = (await resolvePrivateUrl()) || f.permalink || privateUrl;
    if (!next) return;
    const a = document.createElement("a");
    a.href = next;
    a.download = label;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }, [resolvePrivateUrl, f.permalink, privateUrl, label]);

  const sizeLabel = formatFileSize(f.size);
  // Slack bloquea thumbs cross-origin (CORB) y rate-limita (429). Siempre resolvemos vía Edge `slack-api`.
  const imageSrc = resolvedUrl;

  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const handleSyncToKawiil = useCallback(async () => {
    if (synced || syncing) return;
    setSyncing(true);
    try {
      // Placeholder: deja rastro visual inmediato y preparado para integración
      // futura con `knowledge-sync` / `index-chat-attachment` / Dropbox.
      await new Promise((r) => setTimeout(r, 600));
      setSynced(true);
      toast.success("Sincronización con Kawiil encolada.", {
        description: `${label} se indexará en tu base de conocimiento.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo sincronizar");
    } finally {
      setSyncing(false);
    }
  }, [label, synced, syncing]);

  return (
    <div ref={wrapperRef} className="mt-1 flex flex-wrap gap-2">
      {isImg && privateUrl ? (
        <button
          type="button"
          onClick={openAttachment}
          className="relative block rounded-md border border-border/60 overflow-hidden max-w-[260px] text-left"
          title="Abrir imagen"
        >
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={label}
              loading="lazy"
              decoding="async"
              className="max-h-52 w-auto object-cover"
            />
          ) : (
            <div className="flex h-40 w-[260px] items-center justify-center bg-muted/50">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          )}
        </button>
      ) : (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2 py-1.5 text-xs">
          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium truncate max-w-[180px]">{label}</span>
          {sizeLabel && <span className="text-muted-foreground shrink-0">{sizeLabel}</span>}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 hover:bg-muted/60"
            onClick={openAttachment}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Abrir"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 hover:bg-muted/60"
            onClick={downloadAttachment}
            disabled={loading}
            title="Descargar"
          >
            <Download className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleSyncToKawiil}
            disabled={syncing || synced}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors",
              synced
                ? "border border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "text-white shadow-sm hover:opacity-95",
            )}
            style={!synced ? { background: KAWIIL_AI_GRADIENT } : undefined}
            title={
              synced
                ? "Ya sincronizado con Kawiil"
                : "Indexar en la base de conocimiento Kawiil"
            }
          >
            {syncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {synced ? "Sincronizado" : "Sync a Kawiil"}
          </button>
        </div>
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
  slackReactionChannelId = null,
  slackSelfUserId = null,
  reactionPending = null,
  onToggleReaction,
  selectedChannelId,
  onCreateTaskFromMessage,
  savedMessageKeys,
  currentChannelName = null,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mentionUserId, setMentionUserId] = useState<string | null>(null);
  const [reactionPickerTs, setReactionPickerTs] = useState<string | null>(null);
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
          <UserAvatar
            name={label}
            avatarUrl={av}
            userId={uid || undefined}
            size="lg"
            className="h-9 w-9 shrink-0 mt-0.5"
          />
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
          {slackReactionChannelId && slackSelfUserId && onToggleReaction ? (
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {(m.reactions || []).map((r) => {
                const userReacted = !!(slackSelfUserId && r.users?.includes(slackSelfUserId));
                const rowPending =
                  reactionPending?.messageTs === m.ts &&
                  slackReactionNamesMatch(reactionPending.name, r.name);
                return (
                  <button
                    key={r.name}
                    type="button"
                    disabled={!!reactionPending && reactionPending.messageTs === m.ts}
                    title={
                      userReacted
                        ? "Quitar tu reacción"
                        : `Añadir :${r.name}: · ${r.users?.map((id) => slackUserDisplayName(id, userMap)).join(", ") || "Slack"}`
                    }
                    onClick={() => onToggleReaction(m.ts, r.name, !userReacted)}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-50",
                      userReacted
                        ? "border-[#611f69]/55 bg-[#611f69]/12 hover:bg-[#611f69]/20"
                        : "border-border/60 bg-muted/40 hover:bg-muted/65",
                      rowPending && "ring-1 ring-primary/40",
                    )}
                  >
                    <span>{reactionLabel(r.name)}</span>
                    <span className="text-muted-foreground tabular-nums">{r.count}</span>
                  </button>
                );
              })}
              <Popover
                open={reactionPickerTs === m.ts}
                onOpenChange={(open) => setReactionPickerTs(open ? m.ts : null)}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    disabled={!!reactionPending && reactionPending.messageTs === m.ts}
                    title="Añadir reacción"
                  >
                    <Smile className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="start" side="top">
                  <p className="text-[10px] text-muted-foreground px-1 pb-1">Reaccionar como en Slack</p>
                  <div className="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto">
                    {REACTION_PICKER_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="text-lg p-1.5 rounded-md hover:bg-muted"
                        title={`:${key}:`}
                        onClick={() => {
                          const existing = m.reactions?.find((r) => slackReactionNamesMatch(r.name, key));
                          const userHas =
                            !!slackSelfUserId && !!(existing?.users?.includes(slackSelfUserId));
                          const apiName = existing?.name ?? key;
                          onToggleReaction(m.ts, apiName, !userHas);
                          setReactionPickerTs(null);
                        }}
                      >
                        {SLACK_EMOJI[key]}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            m.reactions &&
            m.reactions.length > 0 && (
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
            )
          )}
          {(onOpenThread || onCreateTaskFromMessage || selectedChannelId) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {onOpenThread && (
              <Button
                type="button"
                variant={threadActiveHere ? "default" : "secondary"}
                size="sm"
                className={cn(
                  "h-7 gap-1.5 text-xs font-medium shrink-0",
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
              {onCreateTaskFromMessage && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => onCreateTaskFromMessage(m)}
                >
                  <ClipboardPlus className="h-3.5 w-3.5 shrink-0" />
                  Crear tarea
                </Button>
              )}
              {selectedChannelId && (
                <SlackSaveForLaterButton
                  channelId={selectedChannelId}
                  messageTs={m.ts}
                  threadTs={m.thread_ts ?? null}
                  snippet={m.text ?? null}
                  authorSlackUserId={m.user ?? null}
                  authorName={slackUserDisplayName(m.user, userMap)}
                  channelName={currentChannelName}
                  isSaved={!!savedMessageKeys?.has(`${selectedChannelId}|${m.ts}`)}
                  variant="compact"
                />
              )}
            </div>
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
              <UserAvatar
                name={slackUserDisplayName(mentionUserId, userMap)}
                avatarUrl={profileOpen?.avatar_url}
                userId={mentionUserId}
                size="xl"
                showTooltip={false}
              />
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
