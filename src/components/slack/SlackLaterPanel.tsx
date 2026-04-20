import { useMemo, useState } from "react";
import {
  Bookmark,
  X,
  CheckCircle2,
  Archive,
  Trash2,
  RotateCcw,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import {
  useSlackSavedMessages,
  useUpdateSlackSavedStatus,
  useDeleteSlackSavedMessage,
  type SlackSavedStatus,
  type SlackSavedMessage,
} from "@/hooks/useSlackSavedMessages";

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: SlackSavedStatus;
  onJumpToMessage?: (channelId: string, ts: string) => void;
  resolveChannelTitle?: (channelId: string) => string | undefined;
}

const TABS: Array<{ id: SlackSavedStatus; label: string; icon: typeof Clock }> = [
  { id: "in_progress", label: "En curso", icon: Clock },
  { id: "archived", label: "Archivado", icon: Archive },
  { id: "completed", label: "Completados", icon: CheckCircle2 },
];

function channelLabel(m: SlackSavedMessage, resolver?: (id: string) => string | undefined): string {
  const name = m.channel_name || resolver?.(m.channel_id);
  if (name) return name.startsWith("#") || name.startsWith("@") ? name : `#${name}`;
  return m.channel_id;
}

export function SlackLaterPanel({
  open,
  onClose,
  initialTab = "in_progress",
  onJumpToMessage,
  resolveChannelTitle,
}: Props) {
  const [tab, setTab] = useState<SlackSavedStatus>(initialTab);

  const query = useSlackSavedMessages(tab);
  const updateStatus = useUpdateSlackSavedStatus();
  const remove = useDeleteSlackSavedMessage();

  const items = query.data ?? [];

  const counts = useMemo(() => ({ total: items.length }), [items]);

  if (!open) return null;

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
            <Bookmark className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-tight text-white leading-tight">
              Más tarde
            </p>
            <p className="text-[10.5px] text-white/85 truncate leading-tight">
              Mensajes guardados para atender después
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white hover:bg-white/20"
          onClick={onClose}
          aria-label="Cerrar guardados"
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
          {query.isLoading ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Cargando guardados…</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                {tab === "in_progress"
                  ? "Nada pendiente"
                  : tab === "archived"
                    ? "Sin archivados"
                    : "Sin completados"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Guarda un mensaje desde el menú de acciones para tenerlo aquí.
              </p>
            </div>
          ) : (
            items.map((m) => {
              const jump = () => {
                if (m.channel_id && m.message_ts) onJumpToMessage?.(m.channel_id, m.message_ts);
              };
              return (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-lg border border-border/70 bg-background p-3 space-y-2",
                    "hover:border-border transition-colors",
                  )}
                >
                  <button
                    type="button"
                    onClick={jump}
                    className="block w-full text-left space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Bookmark className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                          {channelLabel(m, resolveChannelTitle)}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {formatDistanceToNow(new Date(m.saved_at), {
                          addSuffix: true,
                          locale: es,
                        })}
                      </span>
                    </div>
                    {m.author_name && (
                      <p className="text-[12.5px] font-medium text-foreground line-clamp-1">
                        {m.author_name}
                      </p>
                    )}
                    {m.snippet && (
                      <p className="text-[11.5px] text-muted-foreground line-clamp-3 leading-snug whitespace-pre-wrap">
                        {m.snippet}
                      </p>
                    )}
                  </button>

                  <div className="flex items-center gap-1 pt-1 border-t border-border/50">
                    {tab !== "completed" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-[10.5px] px-2"
                        onClick={() => updateStatus.mutate({ id: m.id, status: "completed" })}
                        disabled={updateStatus.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Completar
                      </Button>
                    )}
                    {tab === "in_progress" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-[10.5px] px-2"
                        onClick={() => updateStatus.mutate({ id: m.id, status: "archived" })}
                        disabled={updateStatus.isPending}
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Archivar
                      </Button>
                    )}
                    {(tab === "archived" || tab === "completed") && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-[10.5px] px-2"
                        onClick={() => updateStatus.mutate({ id: m.id, status: "in_progress" })}
                        disabled={updateStatus.isPending}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reabrir
                      </Button>
                    )}
                    <div className="ml-auto">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-[10.5px] px-2 text-destructive hover:text-destructive"
                        onClick={() => remove.mutate({ id: m.id })}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Quitar
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/60 bg-background/95 px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-muted-foreground">
          {counts.total} en {TABS.find((t) => t.id === tab)?.label.toLowerCase()}
        </span>
      </div>
    </aside>
  );
}
