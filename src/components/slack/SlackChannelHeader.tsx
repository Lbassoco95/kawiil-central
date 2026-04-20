import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Bell,
  BellOff,
  ChevronDown,
  PanelLeft,
  Search,
  Info,
  Users,
  Sparkles,
  Hash,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SlackMessage } from "@/lib/slackApi";
import { toast } from "sonner";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

type Props = {
  title: string;
  channelId: string;
  showHash?: boolean;
  topic?: string;
  memberCount?: number;
  isWatching: boolean;
  onWatchChange: (v: boolean) => void;
  watchPending: boolean;
  onOpenSidebar?: () => void;
  showSidebarTrigger?: boolean;
  messages: SlackMessage[];
  onJumpToMessage: (ts: string) => void;
  aiPanelOpen?: boolean;
  onToggleAiPanel?: () => void;
  /** Banner inline "KAWIIL · RESUMEN DEL CANAL" (v2.4). */
  summaryBannerOpen?: boolean;
  onToggleSummaryBanner?: () => void;
  /** Tipo de conversación para elegir icono (DM, MPIM, canal). Si no se provee se usa Hash. */
  conversationType?: "channel" | "private" | "im" | "mpim";
};

const TYPE_ICON_BG: Record<NonNullable<Props["conversationType"]>, string> = {
  channel: "linear-gradient(135deg, hsl(207 100% 42%), hsl(217 91% 60%))",
  private: "linear-gradient(135deg, hsl(280 65% 50%), hsl(260 70% 60%))",
  im: "linear-gradient(135deg, hsl(160 70% 38%), hsl(180 70% 45%))",
  mpim: "linear-gradient(135deg, hsl(330 75% 55%), hsl(280 70% 55%))",
};

export function SlackChannelHeader({
  title,
  channelId,
  showHash,
  topic,
  memberCount,
  isWatching,
  onWatchChange,
  watchPending,
  onOpenSidebar,
  showSidebarTrigger,
  messages,
  onJumpToMessage,
  aiPanelOpen,
  onToggleAiPanel,
  summaryBannerOpen,
  onToggleSummaryBanner,
  conversationType,
}: Props) {
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [iaOpen, setIaOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const topicLine = topic?.trim() || null;

  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [searchOpen]);

  const runSearch = () => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return;
    const hit = messages.find((m) => m.text?.toLowerCase().includes(q));
    if (hit) {
      onJumpToMessage(hit.ts);
      setSearchOpen(false);
      toast.success("Mensaje encontrado");
    } else {
      toast.message("Sin coincidencias en los mensajes cargados");
    }
  };

  const iaActive = !!summaryBannerOpen || !!aiPanelOpen;

  const tileType = conversationType ?? (showHash ? "channel" : "private");
  const TileIcon =
    tileType === "im" ? MessageCircle : tileType === "mpim" ? Users : Hash;

  return (
    <header
      className="relative shrink-0 z-10 overflow-hidden border-b border-border/60 bg-card px-4 py-3 sm:px-5 sm:py-3.5"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 360px 120px at 0% 0%, hsl(var(--primary) / 0.05), transparent 70%)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {showSidebarTrigger && onOpenSidebar && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 lg:hidden h-8 w-8"
              onClick={onOpenSidebar}
            >
              <PanelLeft className="h-4 w-4" />
              <span className="sr-only">Abrir lista de conversaciones</span>
            </Button>
          )}
          {/* Icon tile estilo v2.4 */}
          <div
            aria-hidden
            className="hidden sm:grid h-9 w-9 place-items-center rounded-xl text-white shadow-sm shrink-0"
            style={{ background: TILE_BG(tileType) }}
          >
            <TileIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground truncate flex items-center gap-1.5">
              {showHash && <span className="text-muted-foreground font-normal">#</span>}
              <span>{title}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground">
              {memberCount != null && (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {memberCount} miembros
                </span>
              )}
              {topicLine && (
                <span className="truncate max-w-[min(100%,420px)]" title={topicLine}>
                  {topicLine}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Buscar en este chat"
              >
                <Search className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-1.5">
                Buscar en este chat
              </p>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                <Input
                  ref={searchInputRef}
                  id="comunicacion-slack-buscar-mensajes"
                  name="comunicacion_slack_buscar_mensajes"
                  autoComplete="off"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                    else if (e.key === "Escape") setSearchOpen(false);
                  }}
                  placeholder="Escribe y pulsa Enter…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
                Solo busca entre los mensajes cargados en esta vista.
              </p>
            </PopoverContent>
          </Popover>

          {(onToggleSummaryBanner || onToggleAiPanel) && (
            <Popover open={iaOpen} onOpenChange={setIaOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className={cn(
                    "h-8 px-2.5 gap-1.5 text-[11px] text-white shadow-sm hover:opacity-95",
                    iaActive && "ring-2 ring-sky-300/60",
                  )}
                  style={{ background: KAWIIL_AI_GRADIENT }}
                  title="Acciones de Kawiil AI en este canal"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Kawiil AI</span>
                  <ChevronDown className="h-3 w-3 opacity-80" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-1">
                <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Kawiil AI en este canal
                </p>
                {onToggleSummaryBanner && (
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                      summaryBannerOpen && "bg-sky-500/10",
                    )}
                    onClick={() => {
                      onToggleSummaryBanner();
                      setIaOpen(false);
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 text-sky-600 shrink-0" />
                    <span className="flex-1">
                      <span className="block font-medium">
                        {summaryBannerOpen ? "Cerrar resumen" : "Resumir este canal"}
                      </span>
                      <span className="block text-[10.5px] text-muted-foreground">
                        Banner inline con los puntos clave.
                      </span>
                    </span>
                  </button>
                )}
                {onToggleAiPanel && (
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                      aiPanelOpen && "bg-sky-500/10",
                    )}
                    onClick={() => {
                      onToggleAiPanel();
                      setIaOpen(false);
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 text-sky-600 shrink-0" />
                    <span className="flex-1">
                      <span className="block font-medium">
                        {aiPanelOpen ? "Cerrar asistente" : "Abrir asistente Kawiil AI"}
                      </span>
                      <span className="block text-[10.5px] text-muted-foreground">
                        Chat lateral con contexto del canal.
                      </span>
                    </span>
                  </button>
                )}
              </PopoverContent>
            </Popover>
          )}

          <Dialog>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Detalles del canal"
              >
                <Info className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {showHash && <span className="text-muted-foreground font-normal">#</span>}
                  {title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    ID
                  </p>
                  <p className="text-xs font-mono break-all">{channelId}</p>
                </div>
                {memberCount != null && (
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Miembros
                    </p>
                    <p className="text-sm">{memberCount}</p>
                  </div>
                )}
                {topicLine && (
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Tema
                    </p>
                    <p className="text-sm text-muted-foreground">{topicLine}</p>
                  </div>
                )}
                <div className="pt-2 border-t border-border/60">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      {isWatching ? (
                        <Bell className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden />
                      ) : (
                        <BellOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <Label
                          htmlFor="slack-watch"
                          className="text-sm font-medium cursor-pointer block"
                        >
                          Avisos en Kawiil
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          {isWatching
                            ? "Recibes avisos por mensajes nuevos. Desactiva para silenciar solo este chat (@menciones siguen)."
                            : "Silenciado solo en este chat. Las menciones directas siguen avisando."}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="slack-watch"
                      checked={isWatching}
                      disabled={watchPending}
                      onCheckedChange={onWatchChange}
                    />
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  );
}

function TILE_BG(t: NonNullable<Props["conversationType"]>) {
  return TYPE_ICON_BG[t];
}
