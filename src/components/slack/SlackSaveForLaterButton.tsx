import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useSaveSlackMessage,
  useUnsaveSlackMessageByRef,
} from "@/hooks/useSlackSavedMessages";

interface Props {
  channelId: string;
  messageTs: string;
  threadTs?: string | null;
  snippet?: string | null;
  authorSlackUserId?: string | null;
  authorName?: string | null;
  channelName?: string | null;
  /** true si el mensaje ya está guardado (en estado in_progress) */
  isSaved: boolean;
  /** variant visual: "compact" para una sola icon-button, "inline" para botón con label. */
  variant?: "compact" | "inline";
  className?: string;
}

/**
 * Toggle Guardar / Quitar de guardados. Diseñado para colocarse en el hover menu
 * de SlackMessageList junto a "Añadir reacción" / "Responder en hilo".
 */
export function SlackSaveForLaterButton({
  channelId,
  messageTs,
  threadTs = null,
  snippet = null,
  authorSlackUserId = null,
  authorName = null,
  channelName = null,
  isSaved,
  variant = "compact",
  className,
}: Props) {
  const save = useSaveSlackMessage();
  const unsave = useUnsaveSlackMessageByRef();
  const pending = save.isPending || unsave.isPending;

  const handleClick = () => {
    if (pending) return;
    if (isSaved) {
      unsave.mutate({ channel_id: channelId, message_ts: messageTs });
    } else {
      save.mutate({
        channel_id: channelId,
        message_ts: messageTs,
        thread_ts: threadTs,
        snippet,
        author_slack_user_id: authorSlackUserId,
        author_name: authorName,
        channel_name: channelName,
      });
    }
  };

  const title = isSaved ? "Quitar de Más tarde" : "Guardar para más tarde";
  const Icon = pending ? Loader2 : isSaved ? BookmarkCheck : Bookmark;

  if (variant === "inline") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={pending}
        className={cn(
          "h-7 gap-1.5 text-xs",
          isSaved && "text-sky-600 dark:text-sky-300 border-sky-300/70",
          className,
        )}
        title={title}
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", pending && "animate-spin")} />
        {isSaved ? "Guardado" : "Guardar"}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={pending}
      className={cn(
        "h-7 w-7 p-0",
        isSaved
          ? "text-sky-600 dark:text-sky-300 hover:text-sky-700"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      title={title}
      aria-label={title}
      aria-pressed={isSaved}
    >
      <Icon className={cn("h-4 w-4", pending && "animate-spin")} />
    </Button>
  );
}
