import { memo, useCallback, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ClipboardPlus,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Smile,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { fetchSlackPrivateFileBlob, type SlackFile, type SlackMessage } from "@/lib/slackApi";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { slackMessageAuthorDisplayName, slackUserDisplayName } from "./slackGrouping";
import { cn } from "@/lib/utils";
import {
  formatDaySeparatorLabel,
  formatSlackMessageTime,
  formatSlackRelativeShort,
  formatSlackTooltipFull,
  isSlackSystemSubtype,
  slackMrkdwnToReact,
  slackSystemMessageLabel,
  slackEmojiAliasToChar,
  type FormatContext,
} from "@/lib/slackFormatting";
import { SLACK_EMOJI } from "@/lib/slackFormatting";
import { SlackSaveForLaterButton } from "@/components/slack/SlackSaveForLaterButton";
import { slackDeepLinkPath } from "@/lib/slackDeepLink";
import type { SlackListRow } from "./slackListRows";
import { slackThreadRootTs } from "./slackListRows";

const QUICK_REACTION_KEYS = ["thumbsup", "heart", "white_check_mark", "eyes"] as const;

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

function FileAttachmentPreview({
  f,
  onPreview,
}: {
  f: SlackFile;
  onPreview: (file: SlackFile) => void;
}) {
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

  const openAttachment = useCallback(() => {
    if (!privateUrl && !f.permalink) return;
    onPreview(f);
  }, [f, onPreview, privateUrl]);

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
  const imageSrc = resolvedUrl;

  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const handleSyncToKawiil = useCallback(async () => {
    if (synced || syncing) return;
    setSyncing(true);
    try {
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

export type SlackMessageListRowViewProps = {
  row: SlackListRow;
  anchorTs: string;
  formatCtx: FormatContext;
  userMap: Record<string, SlackUserProfile | undefined>;
  activeThreadRootTs: string | null;
  slackReactionChannelId: string | null;
  slackSelfUserId: string | null;
  reactionPending: { messageTs: string; name: string } | null;
  onToggleReaction?: (messageTs: string, emojiName: string, add: boolean) => void;
  selectedChannelId: string;
  savedMessageKeys?: Set<string>;
  currentChannelName: string | null;
  onOpenThread?: (threadTs: string) => void;
  onCreateTaskFromMessage?: (message: SlackMessage) => void;
  onEditSlackMessage?: (ts: string, text: string) => void;
  onDeleteSlackMessage?: (ts: string) => void;
  slackMessageActionPending: boolean;
  onPreviewFile: (f: SlackFile) => void;
  reactionPickerTs: string | null;
  onReactionPickerTs: (ts: string | null) => void;
  onEditStart: (m: SlackMessage) => void;
  onDeleteAsk: (ts: string) => void;
};

function SlackMessageListRowViewInner({
  row,
  anchorTs,
  formatCtx,
  userMap,
  activeThreadRootTs,
  slackReactionChannelId,
  slackSelfUserId,
  reactionPending,
  onToggleReaction,
  selectedChannelId,
  savedMessageKeys,
  currentChannelName,
  onOpenThread,
  onCreateTaskFromMessage,
  onEditSlackMessage,
  onDeleteSlackMessage,
  slackMessageActionPending,
  onPreviewFile,
  reactionPickerTs,
  onReactionPickerTs,
  onEditStart,
  onDeleteAsk,
}: SlackMessageListRowViewProps) {
  if (row.type === "day") {
    return (
      <div className="flex items-center gap-3 my-4 px-1 pb-1" aria-hidden>
        <div className="flex-1 h-px bg-border/60" />
        <span className="text-[11px] font-semibold text-muted-foreground bg-background border border-border/60 px-3 py-1 rounded-full">
          {formatDaySeparatorLabel(row.ts)}
        </span>
        <div className="flex-1 h-px bg-border/60" />
      </div>
    );
  }

  if (row.type === "newDivider") {
    return (
      <div
        className="flex items-center gap-2 my-2 px-1 pb-1"
        role="separator"
        aria-label="Nuevos mensajes"
      >
        <div className="flex-1 h-px bg-destructive/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive">
          Nuevos
        </span>
        <div className="flex-1 h-px bg-destructive/50" />
      </div>
    );
  }

  if (row.type === "system") {
    const m = row.message;
    const idSafe = m.ts.replace(/\./g, "-");
    const highlight = !!anchorTs && m.ts === anchorTs;
    return (
      <div
        id={`slack-msg-${idSafe}`}
        className={cn(
          "flex justify-center px-4 py-1 pb-2 text-center text-xs text-muted-foreground",
          highlight && "bg-primary/[0.08] rounded-md",
        )}
      >
        <span className="inline-flex items-center gap-1.5 max-w-lg">
          <UserPlus className="h-3 w-3 shrink-0 opacity-70" />
          {slackMrkdwnToReact(slackSystemMessageLabel(m), formatCtx) || slackSystemMessageLabel(m)}
        </span>
      </div>
    );
  }

  const m = row.message;
  const idSafe = m.ts.replace(/\./g, "-");
  const highlight = !!anchorTs && m.ts === anchorTs;
  const uid = m.user;
  const label = slackMessageAuthorDisplayName(m, userMap);
  const prof = uid ? userMap[uid] : undefined;
  const av = prof?.avatar_url;
  const group = row.group;
  const showHeader = row.showHeader;
  const bodyText = m.text?.trim();
  const hasFiles = (m.files?.length ?? 0) > 0;
  const rootTs = slackThreadRootTs(m);
  const threadActiveHere = !!activeThreadRootTs && activeThreadRootTs === rootTs;
  const canReact = !!(slackReactionChannelId && slackSelfUserId && onToggleReaction);
  const reactionsList = m.reactions ?? [];
  const replyCount = m.reply_count ?? 0;
  const hasReplies = replyCount > 0;
  const replyUserIds = (m.reply_users ?? []).slice(0, 3);
  const latestReplyTs = m.latest_reply ?? null;
  const isSaved = !!(selectedChannelId && savedMessageKeys?.has(`${selectedChannelId}|${m.ts}`));
  const isOwnMessage = !!(slackSelfUserId && uid === slackSelfUserId);
  const canModifyOwnMessage =
    isOwnMessage &&
    !isSlackSystemSubtype(m.subtype) &&
    !!slackReactionChannelId &&
    !!(onEditSlackMessage || onDeleteSlackMessage);

  return (
    <div
      id={`slack-msg-${idSafe}`}
      className={cn(
        "group relative flex gap-3 rounded-lg px-2 -mx-2 transition-colors pb-1",
        group ? "py-px" : "py-0.5",
        showHeader ? "pt-1.5" : "pt-0",
        highlight ? "bg-primary/[0.08] ring-1 ring-primary/20" : "hover:bg-muted/40",
        threadActiveHere && "ring-1 ring-[#611f69]/25",
      )}
    >
      {showHeader ? (
        <UserAvatar
          name={label}
          avatarUrl={av}
          userId={uid || undefined}
          size="lg"
          className="h-9 w-9 shrink-0 mt-0.5 rounded-md"
          fallbackClassName="rounded-md"
        />
      ) : (
        <div className="w-9 shrink-0 flex items-start justify-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10.5px] text-transparent group-hover:text-muted-foreground tabular-nums cursor-default pt-1 select-none">
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
        <div className="text-sm text-foreground/95 whitespace-pre-wrap break-words leading-[1.45] mt-0.5">
          {bodyText ? slackMrkdwnToReact(bodyText, formatCtx) : null}
          {m.files?.map((f) => (
            <FileAttachmentPreview key={f.id || f.name} f={f} onPreview={onPreviewFile} />
          ))}
          {!bodyText && !hasFiles && (
            <span className="text-muted-foreground italic text-xs">Sin texto ni adjuntos</span>
          )}
        </div>
        {reactionsList.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {reactionsList.map((r) => {
              const userReacted = !!(slackSelfUserId && r.users?.includes(slackSelfUserId));
              const rowPending =
                reactionPending?.messageTs === m.ts &&
                slackReactionNamesMatch(reactionPending.name, r.name);
              const interactive = canReact;
              return (
                <button
                  key={r.name}
                  type="button"
                  disabled={!interactive || (!!reactionPending && reactionPending.messageTs === m.ts)}
                  title={
                    userReacted
                      ? "Quitar tu reacción"
                      : `:${r.name}: · ${r.users?.map((id) => slackUserDisplayName(id, userMap)).join(", ") || "Slack"}`
                  }
                  onClick={() => interactive && onToggleReaction?.(m.ts, r.name, !userReacted)}
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-[1px] text-[10.5px] transition-colors disabled:opacity-60",
                    userReacted
                      ? "border-[#611f69]/55 bg-[#611f69]/12 hover:bg-[#611f69]/20"
                      : "border-border/60 bg-muted/40 hover:bg-muted/65",
                    rowPending && "ring-1 ring-primary/40",
                    !interactive && "cursor-default",
                  )}
                >
                  <span>{reactionLabel(r.name)}</span>
                  <span className="text-muted-foreground tabular-nums">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}
        {onOpenThread && hasReplies && (
          <button
            type="button"
            onClick={() => onOpenThread(rootTs)}
            className={cn(
              "mt-1 flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 transition-colors group/thread",
              threadActiveHere
                ? "bg-[#611f69]/10 hover:bg-[#611f69]/15"
                : "hover:bg-muted/60",
            )}
            title={threadActiveHere ? "Hilo abierto" : "Ver hilo"}
          >
            <div className="flex -space-x-1.5">
              {replyUserIds.length > 0 ? (
                replyUserIds.map((id) => {
                  const p = userMap[id];
                  return (
                    <UserAvatar
                      key={id}
                      name={slackUserDisplayName(id, userMap)}
                      avatarUrl={p?.avatar_url}
                      userId={id}
                      size="xs"
                      showTooltip={false}
                      className="ring-2 ring-background rounded-md"
                      fallbackClassName="rounded-md"
                    />
                  );
                })
              ) : (
                <MessageSquareText className="h-3.5 w-3.5 text-[#611f69]" />
              )}
            </div>
            <span className="text-xs font-semibold text-[#611f69] dark:text-sky-300">
              {replyCount} {replyCount === 1 ? "respuesta" : "respuestas"}
            </span>
            {latestReplyTs && (
              <span className="text-[11px] text-muted-foreground">
                Última {formatSlackRelativeShort(latestReplyTs)}
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground opacity-0 group-hover/thread:opacity-100 transition-opacity">
              Ver hilo →
            </span>
          </button>
        )}
      </div>

      {(canReact || onOpenThread || onCreateTaskFromMessage || selectedChannelId) && (
        <div
          className={cn(
            "absolute -top-3 right-3 z-10",
            "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
            "group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
            "transition-opacity",
          )}
        >
          <div className="flex items-center gap-0.5 rounded-md border border-border/70 bg-popover shadow-md px-0.5 py-0.5">
            {canReact &&
              QUICK_REACTION_KEYS.map((key) => {
                const existing = m.reactions?.find((r) => slackReactionNamesMatch(r.name, key));
                const userHas = !!slackSelfUserId && !!existing?.users?.includes(slackSelfUserId);
                const pending =
                  reactionPending?.messageTs === m.ts &&
                  slackReactionNamesMatch(reactionPending.name, key);
                return (
                  <button
                    key={`quick-${key}`}
                    type="button"
                    title={userHas ? "Quitar tu reacción" : `Reaccionar :${key}:`}
                    className={cn(
                      "h-7 w-7 rounded text-base leading-none grid place-items-center hover:bg-muted transition-colors disabled:opacity-50",
                      userHas && "bg-[#611f69]/12",
                      pending && "animate-pulse",
                    )}
                    disabled={!!reactionPending && reactionPending.messageTs === m.ts}
                    onClick={() => {
                      const apiName = existing?.name ?? key;
                      onToggleReaction?.(m.ts, apiName, !userHas);
                    }}
                  >
                    {SLACK_EMOJI[key]}
                  </button>
                );
              })}
            {canReact && (
              <Popover
                open={reactionPickerTs === m.ts}
                onOpenChange={(open) => onReactionPickerTs(open ? m.ts : null)}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    disabled={!!reactionPending && reactionPending.messageTs === m.ts}
                    title="Más reacciones"
                  >
                    <Smile className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="end" side="top">
                  <p className="text-[10px] text-muted-foreground px-1 pb-1">
                    Reaccionar como en Slack
                  </p>
                  <div className="grid grid-cols-8 gap-1 max-h-52 overflow-y-auto">
                    {REACTION_PICKER_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="text-lg p-1.5 rounded-md hover:bg-muted"
                        title={`:${key}:`}
                        onClick={() => {
                          const existing = m.reactions?.find((r) =>
                            slackReactionNamesMatch(r.name, key),
                          );
                          const userHas =
                            !!slackSelfUserId && !!existing?.users?.includes(slackSelfUserId);
                          const apiName = existing?.name ?? key;
                          onToggleReaction?.(m.ts, apiName, !userHas);
                          onReactionPickerTs(null);
                        }}
                      >
                        {SLACK_EMOJI[key]}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {onOpenThread && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0",
                  threadActiveHere
                    ? "text-[#611f69] hover:text-[#4a154b]"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title={
                  hasReplies
                    ? `${replyCount} en el hilo`
                    : threadActiveHere
                      ? "Hilo abierto"
                      : "Responder en hilo"
                }
                onClick={() => onOpenThread(rootTs)}
              >
                <MessageSquareText className="h-4 w-4" />
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
                isSaved={isSaved}
                variant="compact"
              />
            )}
            {(onCreateTaskFromMessage || selectedChannelId || onOpenThread) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    title="Más acciones"
                    aria-label="Más acciones"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-56">
                  {canModifyOwnMessage && onEditSlackMessage && (
                    <DropdownMenuItem
                      disabled={slackMessageActionPending}
                      onSelect={() => onEditStart(m)}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Editar mensaje
                    </DropdownMenuItem>
                  )}
                  {canModifyOwnMessage && onDeleteSlackMessage && (
                    <DropdownMenuItem
                      disabled={slackMessageActionPending}
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onDeleteAsk(m.ts)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Eliminar…
                    </DropdownMenuItem>
                  )}
                  {onCreateTaskFromMessage && (
                    <DropdownMenuItem onSelect={() => onCreateTaskFromMessage(m)}>
                      <ClipboardPlus className="h-4 w-4 mr-2" />
                      Crear tarea
                    </DropdownMenuItem>
                  )}
                  {onOpenThread && (
                    <DropdownMenuItem onSelect={() => onOpenThread(rootTs)}>
                      <MessageSquareText className="h-4 w-4 mr-2" />
                      {hasReplies ? "Ir al hilo" : "Responder en hilo"}
                    </DropdownMenuItem>
                  )}
                  {selectedChannelId && (
                    <DropdownMenuItem
                      onSelect={async () => {
                        const path = slackDeepLinkPath(`${selectedChannelId}|${m.ts}`);
                        if (!path) return;
                        const url = `${window.location.origin}${path}`;
                        try {
                          await navigator.clipboard.writeText(url);
                          toast.success("Enlace al mensaje copiado");
                        } catch {
                          toast.error("No se pudo copiar el enlace");
                        }
                      }}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copiar enlace al mensaje
                    </DropdownMenuItem>
                  )}
                  {bodyText && (
                    <DropdownMenuItem
                      onSelect={async () => {
                        try {
                          await navigator.clipboard.writeText(bodyText);
                          toast.success("Texto copiado");
                        } catch {
                          toast.error("No se pudo copiar el texto");
                        }
                      }}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Copiar texto
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function rowComparable(prev: SlackMessageListRowViewProps, next: SlackMessageListRowViewProps): boolean {
  if (prev.row !== next.row) {
    if (prev.row.type !== next.row.type) return false;
    if (prev.row.type === "day" && next.row.type === "day") {
      if (prev.row.key !== next.row.key) return false;
    } else if (prev.row.type === "newDivider" && next.row.type === "newDivider") {
      if (prev.row.key !== next.row.key) return false;
    } else if (prev.row.type === "message" && next.row.type === "message") {
      if (prev.row.message !== next.row.message) return false;
      if (prev.row.group !== next.row.group) return false;
      if (prev.row.showHeader !== next.row.showHeader) return false;
    } else if (prev.row.type === "system" && next.row.type === "system") {
      if (prev.row.message !== next.row.message) return false;
    }
  }
  if (prev.anchorTs !== next.anchorTs) return false;
  if (prev.formatCtx !== next.formatCtx) return false;
  if (prev.userMap !== next.userMap) return false;
  if (prev.activeThreadRootTs !== next.activeThreadRootTs) return false;
  if (prev.reactionPickerTs !== next.reactionPickerTs) return false;
  const pts = prev.row.type === "message" || prev.row.type === "system" ? prev.row.message.ts : null;
  const nts = next.row.type === "message" || next.row.type === "system" ? next.row.message.ts : null;
  if (pts && nts && pts === nts) {
    if (prev.reactionPending?.messageTs === pts || next.reactionPending?.messageTs === nts) {
      if (
        prev.reactionPending?.messageTs !== next.reactionPending?.messageTs ||
        prev.reactionPending?.name !== next.reactionPending?.name
      ) {
        return false;
      }
    }
  } else if (prev.reactionPending !== next.reactionPending) return false;
  if (prev.slackMessageActionPending !== next.slackMessageActionPending) return false;
  if (prev.savedMessageKeys !== next.savedMessageKeys) return false;
  if (prev.currentChannelName !== next.currentChannelName) return false;
  return (
    prev.slackReactionChannelId === next.slackReactionChannelId &&
    prev.slackSelfUserId === next.slackSelfUserId &&
    prev.selectedChannelId === next.selectedChannelId
  );
}

export const SlackMessageListRowView = memo(SlackMessageListRowViewInner, rowComparable);
