import { useEffect, useMemo, useState } from "react";
import { Activity, AtSign, MessageCircle, MessageSquare, Smile, X, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import {
  useSlackActivityFeed,
  useMarkSlackActivityRead,
  useMarkAllSlackActivityRead,
  type SlackActivityTab,
  type SlackActivityItem,
} from "@/hooks/useSlackActivityFeed";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tab inicial (cuando se abre el panel). */
  initialTab?: SlackActivityTab;
  /**
   * Saltar al mensaje original al hacer click en un item. Si no está disponible,
   * el panel solo marca como leído.
   */
  onJumpToMessage?: (channelId: string, ts: string) => void;
  /** Resolver etiqueta amable para el channel_id (nombre de canal o contraparte de DM). */
  resolveChannelTitle?: (channelId: string) => string | undefined;
}

const TABS: Array<{ id: SlackActivityTab; label: string; icon: typeof Activity }> = [
  { id: "all", label: "Todo", icon: Activity },
  { id: "mentions", label: "Menciones", icon: AtSign },
  { id: "threads", label: "Hilos", icon: MessageCircle },
  { id: "dms", label: "DMs", icon: MessageSquare },
  { id: "reactions", label: "Reacciones", icon: Smile },
];

function ItemIcon({ type }: { type: string }) {
  if (type === "slack_mention")
    return <AtSign className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />;
  if (type === "slack_reaction")
    return <Smile className="h-3.5 w-3.5 text-amber-500" />;
  if (type === "slack_thread_reply")
    return <MessageCircle className="h-3.5 w-3.5 text-indigo-500" />;
  if (type === "slack_dm")
    return <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />;
  return <MessageSquare className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />;
}

function itemChannelLabel(item: SlackActivityItem, resolver?: (id: string) => string | undefined): string {
  if (!item.channel_id) return "Slack";
  const name = resolver?.(item.channel_id);
  if (name) return name.startsWith("#") || name.startsWith("@") ? name : `#${name}`;
  return item.channel_id;
}

export function SlackActivityPanel({
  open,
  onClose,
  initialTab = "all",
  onJumpToMessage,
  resolveChannelTitle,
}: Props) {
  const [tab, setTab] = useState<SlackActivityTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const feed = useSlackActivityFeed(tab);
  const markRead = useMarkSlackActivityRead();
  const markAllRead = useMarkAllSlackActivityRead();

  const items = feed.data ?? [];
  const unreadIds = useMemo(() => items.filter((i) => !i.is_read).map((i) => i.id), [items]);

  if (!open) return null;

  const handleItemClick = (item: SlackActivityItem) => {
    if (!item.is_read) markRead.mutate({ ids: [item.id] });
    if (item.channel_id && item.message_ts) {
      onJumpToMessage?.(item.channel_id, item.message_ts);
    }
  };

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col border-l border-border/60 bg-card",
        "w-full sm:w-[380px] lg:w-[400px] min-w-0",
      )}
    >
      <div
        className="shrink-0 flex items-center justify-between border-b border-sky-200/40 dark:border-sky-800/30 px-4 py-3"
        style={{ background: KAWIIL_AI_HEADER_BG }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl text-white shadow-sm shrink-0"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Activity className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-tight text-white leading-tight">
              Actividad
            </p>
            <p className="text-[10.5px] text-white/85 truncate leading-tight">
              Menciones, hilos, DMs y reacciones
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white hover:bg-white/20"
          onClick={onClose}
          aria-label="Cerrar actividad"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="shrink-0 border-b border-border/60 bg-background/95 px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider transition-colors",
                  active
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-sky-100 dark:hover:bg-sky-900/20",
                )}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {feed.isLoading ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Cargando actividad…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-foreground">Todo al día</p>
              <p className="text-xs text-muted-foreground mt-1">
                {tab === "mentions"
                  ? "Sin menciones pendientes."
                  : tab === "threads"
                    ? "Sin respuestas nuevas en hilos."
                    : tab === "dms"
                      ? "Sin mensajes directos nuevos."
                      : tab === "reactions"
                        ? "Sin reacciones nuevas."
                        : "Sin actividad reciente."}
              </p>
            </div>
          ) : (
            items.map((item) => {
              const unread = !item.is_read;
              const authorName =
                item.source_profile?.full_name ||
                item.source_profile?.user_id ||
                "Usuario";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className={cn(
                    "w-full text-left rounded-lg border bg-background p-3 space-y-1.5 transition-colors",
                    unread
                      ? "border-sky-200 hover:border-sky-300 dark:border-sky-800/50 dark:hover:border-sky-700/60"
                      : "border-border/70 hover:border-border",
                    "hover:bg-accent/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ItemIcon type={item.type} />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                        {itemChannelLabel(item, resolveChannelTitle)}
                      </span>
                      {unread && (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden />
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                      {formatDistanceToNow(new Date(item.created_at), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </span>
                  </div>
                  <p className="text-[12.5px] font-medium text-foreground line-clamp-1">
                    {item.title || authorName}
                  </p>
                  {item.body && (
                    <p className="text-[11.5px] text-muted-foreground line-clamp-2 leading-snug">
                      {item.body}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/60 bg-background/95 px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-muted-foreground">
          {unreadIds.length > 0 ? `${unreadIds.length} sin leer` : "Sin pendientes"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[11px]"
          disabled={unreadIds.length === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Marcar todo leído
        </Button>
      </div>
    </aside>
  );
}
