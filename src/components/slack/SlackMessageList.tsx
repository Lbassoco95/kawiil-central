import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { UserAvatar } from "@/components/shared/UserAvatar";
import type { SlackFile, SlackMessage } from "@/lib/slackApi";
import { slackUserDisplayName } from "./slackGrouping";
import { SlackAttachmentPreviewDialog } from "@/components/slack/SlackAttachmentPreviewDialog";
import type { FormatContext } from "@/lib/slackFormatting";
import { buildSlackListRows, estimateSlackRowHeight } from "./slackListRows";
import { SlackMessageListRowView } from "./SlackMessageListRowView";

type Props = {
  messages: SlackMessage[];
  userMap: Record<string, SlackUserProfile | undefined>;
  highlightTs: string;
  isLoading: boolean;
  /** Tras varios segundos de carga inicial, muestra texto y reintento. */
  loadSlowHint?: boolean;
  onRetryLoad?: () => void;
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
  /**
   * TS del último mensaje considerado leído (máximo entre `last_read` de Slack y cursor local en Comunicación).
   * Alimenta el divisor «Nuevos» antes del primer mensaje posterior.
   */
  lastReadTs?: string | null;
  /** Editar mensaje propio (Slack `chat.update`). Requiere canal real en `slackReactionChannelId`. */
  onEditSlackMessage?: (ts: string, text: string) => void;
  /** Eliminar mensaje propio (Slack `chat.delete`). */
  onDeleteSlackMessage?: (ts: string) => void;
  slackMessageActionPending?: boolean;
};

const ANCHOR_PREFETCH_MAX = 25;
const ANCHOR_PREFETCH_DELAY_MS = 400;

// Virtualización (@tanstack/react-virtual): menos nodos DOM con historiales largos; perfilar con React Profiler si sigue lento.
export function SlackMessageList({
  messages,
  userMap,
  highlightTs,
  isLoading,
  loadSlowHint = false,
  onRetryLoad,
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
  lastReadTs = null,
  onEditSlackMessage,
  onDeleteSlackMessage,
  slackMessageActionPending = false,
}: Props) {
  const anchorTs = (highlightTs ?? "").trim();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mentionUserId, setMentionUserId] = useState<string | null>(null);
  const [reactionPickerTs, setReactionPickerTs] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<SlackFile | null>(null);
  const [editTarget, setEditTarget] = useState<SlackMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleteTargetTs, setDeleteTargetTs] = useState<string | null>(null);
  const prevLenRef = useRef(0);
  const stickBottomRef = useRef(true);
  const anchorPrefetchCountRef = useRef(0);
  const anchorPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSelectedChannelRef = useRef(selectedChannelId);

  const formatCtx = useMemo<FormatContext>(
    () => ({
      userMap,
      onUserMentionClick: (id) => setMentionUserId(id),
    }),
    [userMap],
  );

  const listRows = useMemo(
    () => buildSlackListRows(messages, lastReadTs ?? null),
    [messages, lastReadTs],
  );

  const rowVirtualizer = useVirtualizer({
    count: listRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const r = listRows[index];
      return r ? estimateSlackRowHeight(r) : 72;
    },
    overscan: 12,
    getItemKey: (index) => listRows[index]?.key ?? index,
  });

  const onReactionPickerTs = useCallback((ts: string | null) => {
    setReactionPickerTs(ts);
  }, []);

  const onEditStart = useCallback((m: SlackMessage) => {
    setEditTarget(m);
    setEditDraft(m.text ?? "");
  }, []);

  const onDeleteAsk = useCallback((ts: string) => {
    setDeleteTargetTs(ts);
  }, []);

  const scrollToBottomStable = useCallback(() => {
    const snap = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    snap();
    requestAnimationFrame(() => {
      snap();
      requestAnimationFrame(snap);
    });
  }, []);

  useLayoutEffect(() => {
    if (!messages.length || anchorTs) return;
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length !== prevLenRef.current) {
      if (stickBottomRef.current || messages.length <= prevLenRef.current) {
        scrollToBottomStable();
      }
      prevLenRef.current = messages.length;
    }
  }, [messages.length, messages, anchorTs, scrollToBottomStable]);

  useLayoutEffect(() => {
    if (prevSelectedChannelRef.current !== selectedChannelId) {
      prevSelectedChannelRef.current = selectedChannelId;
      prevLenRef.current = 0;
      stickBottomRef.current = true;
    }
    anchorPrefetchCountRef.current = 0;
    if (anchorPrefetchTimeoutRef.current) {
      clearTimeout(anchorPrefetchTimeoutRef.current);
      anchorPrefetchTimeoutRef.current = null;
    }

    if (anchorTs) return;
    scrollToBottomStable();
  }, [selectedChannelId, anchorTs, scrollToBottomStable]);

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

  const highlightAnchorInList = useMemo(
    () => (anchorTs ? messages.some((m) => m.ts === anchorTs) : false),
    [messages, anchorTs],
  );

  const anchorRowIndex = useMemo(() => {
    if (!anchorTs) return -1;
    return listRows.findIndex(
      (r) =>
        (r.type === "message" || r.type === "system") && r.message.ts === anchorTs,
    );
  }, [listRows, anchorTs]);

  useLayoutEffect(() => {
    if (!anchorTs || anchorRowIndex < 0 || !highlightAnchorInList) return;
    rowVirtualizer.scrollToIndex(anchorRowIndex, { align: "center" });
  }, [anchorTs, anchorRowIndex, highlightAnchorInList, messages.length, rowVirtualizer]);

  /** Mientras haya ancla en la URL y el mensaje no esté en el lote cargado, pide más historial (tope, con retraso entre páginas). */
  useEffect(() => {
    if (!anchorTs || !onLoadMore || !hasMore) return;
    if (highlightAnchorInList) return;
    if (isFetchingMore) return;
    if (anchorPrefetchCountRef.current >= ANCHOR_PREFETCH_MAX) return;
    if (anchorPrefetchTimeoutRef.current) clearTimeout(anchorPrefetchTimeoutRef.current);
    anchorPrefetchTimeoutRef.current = setTimeout(() => {
      anchorPrefetchTimeoutRef.current = null;
      if (anchorPrefetchCountRef.current >= ANCHOR_PREFETCH_MAX) return;
      anchorPrefetchCountRef.current += 1;
      onLoadMore();
    }, ANCHOR_PREFETCH_DELAY_MS);
    return () => {
      if (anchorPrefetchTimeoutRef.current) {
        clearTimeout(anchorPrefetchTimeoutRef.current);
        anchorPrefetchTimeoutRef.current = null;
      }
    };
  }, [
    anchorTs,
    highlightAnchorInList,
    hasMore,
    isFetchingMore,
    onLoadMore,
    messages.length,
  ]);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center min-h-[200px] gap-4 px-4">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        {loadSlowHint && (
          <div className="text-center space-y-2 max-w-sm">
            <p className="text-sm text-muted-foreground">
              Slack está tardando más de lo habitual (la primera carga puede llevar hasta ~2 min en canales
              complejos). Comprueba la red, usa «Actualizar permisos Slack» en la barra lateral si falta algún
              permiso, o reintenta.
            </p>
            {onRetryLoad && (
              <Button type="button" variant="outline" size="sm" onClick={onRetryLoad}>
                Reintentar
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error.message}</div>;
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
            <div
              className="flex justify-center items-center gap-2 py-2"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Cargando mensajes anteriores…</span>
            </div>
          )}
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = listRows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <SlackMessageListRowView
                    row={row}
                    anchorTs={anchorTs}
                    formatCtx={formatCtx}
                    userMap={userMap}
                    activeThreadRootTs={activeThreadRootTs}
                    slackReactionChannelId={slackReactionChannelId}
                    slackSelfUserId={slackSelfUserId}
                    reactionPending={reactionPending ?? null}
                    onToggleReaction={onToggleReaction}
                    selectedChannelId={selectedChannelId}
                    savedMessageKeys={savedMessageKeys}
                    currentChannelName={currentChannelName}
                    onOpenThread={onOpenThread}
                    onCreateTaskFromMessage={onCreateTaskFromMessage}
                    onEditSlackMessage={onEditSlackMessage}
                    onDeleteSlackMessage={onDeleteSlackMessage}
                    slackMessageActionPending={slackMessageActionPending}
                    onPreviewFile={setPreviewFile}
                    reactionPickerTs={reactionPickerTs}
                    onReactionPickerTs={onReactionPickerTs}
                    onEditStart={onEditStart}
                    onDeleteAsk={onDeleteAsk}
                  />
                </div>
              );
            })}
          </div>
          {bottomRef && <div ref={bottomRef} className="h-2" />}
        </div>
      </div>
      <SlackAttachmentPreviewDialog
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(o) => !o && setPreviewFile(null)}
      />
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
      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => {
          if (!o) {
            setEditTarget(null);
            setEditDraft("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar mensaje</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={5}
            className="text-sm"
            disabled={slackMessageActionPending}
            placeholder="Texto del mensaje (mrkdwn de Slack)"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditTarget(null);
                setEditDraft("");
              }}
              disabled={slackMessageActionPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={slackMessageActionPending || !editDraft.trim() || !editTarget}
              onClick={() => {
                if (!editTarget || !onEditSlackMessage) return;
                const t = editDraft.trim();
                if (!t) return;
                onEditSlackMessage(editTarget.ts, t);
                setEditTarget(null);
                setEditDraft("");
              }}
            >
              {slackMessageActionPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Guardar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleteTargetTs} onOpenChange={(o) => !o && setDeleteTargetTs(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar mensaje</AlertDialogTitle>
            <AlertDialogDescription>
              Esto borrará el mensaje en Slack para todos. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={slackMessageActionPending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={slackMessageActionPending}
              onClick={() => {
                if (deleteTargetTs && onDeleteSlackMessage) {
                  onDeleteSlackMessage(deleteTargetTs);
                }
                setDeleteTargetTs(null);
              }}
            >
              {slackMessageActionPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Eliminar"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
