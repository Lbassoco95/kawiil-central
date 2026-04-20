import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, PanelLeft, Search, Info, Users, Sparkles, Hash, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

  const topicLine = topic?.trim() || null;

  const runSearch = () => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return;
    const hit = messages.find((m) => m.text?.toLowerCase().includes(q));
    if (hit) {
      onJumpToMessage(hit.ts);
      toast.success("Mensaje encontrado");
    } else {
      toast.message("Sin coincidencias en los mensajes cargados");
    }
  };

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
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="hidden sm:flex items-center gap-1 max-w-[220px]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
              <Input
                id="comunicacion-slack-buscar-mensajes"
                name="comunicacion_slack_buscar_mensajes"
                autoComplete="off"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Buscar en este chat…"
                className="h-8 pl-8 text-xs bg-background/60 border-border focus-visible:ring-primary/30"
              />
            </div>
          </div>
          {onToggleSummaryBanner ? (
            <Button
              type="button"
              size="sm"
              className={cn(
                "h-8 px-2.5 gap-1.5 text-[11px] text-white shadow-sm hover:opacity-95",
                summaryBannerOpen && "ring-2 ring-sky-300/60",
              )}
              style={{ background: KAWIIL_AI_GRADIENT }}
              onClick={onToggleSummaryBanner}
              title={
                summaryBannerOpen
                  ? "Cerrar resumen del canal"
                  : "Resumir este canal con Kawiil AI"
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Resumir con Kawiil</span>
            </Button>
          ) : null}
          {onToggleAiPanel ? (
            <Button
              type="button"
              variant={aiPanelOpen ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-8 px-2.5 gap-1.5 text-[11px] transition-all",
                aiPanelOpen
                  ? "shadow-sm"
                  : "border-sky-300/40 dark:border-sky-700/40 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/10",
              )}
              onClick={onToggleAiPanel}
              title={aiPanelOpen ? "Cerrar asistente IA del canal" : "Abrir asistente IA del canal"}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Kawiil AI</span>
            </Button>
          ) : null}
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Detalles">
                <Info className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Detalle del canal</DialogTitle>
              </DialogHeader>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground font-mono break-all">{channelId}</p>
              {topicLine && <p className="text-sm text-muted-foreground mt-2">{topicLine}</p>}
            </DialogContent>
          </Dialog>
          <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2 py-1">
            {isWatching ? (
              <Bell className="h-3.5 w-3.5 text-primary" aria-hidden />
            ) : (
              <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            )}
            <Switch
              id="slack-watch"
              checked={isWatching}
              disabled={watchPending}
              onCheckedChange={onWatchChange}
              title={
                isWatching
                  ? "Recibes avisos en Kawiil por mensajes en este chat. Desactiva para silenciar solo aquí (@menciones siguen)."
                  : "Avisos silenciados solo en este chat. Activa para volver a recibir mensajes (si los avisos globales están encendidos en Notificaciones)."
              }
            />
            <Label
              htmlFor="slack-watch"
              className="text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap"
              title="Por defecto encendido en todos los canales; aquí solo silencias esta conversación."
            >
              Avisos
            </Label>
          </div>
        </div>
      </div>
    </header>
  );
}

function TILE_BG(t: NonNullable<Props["conversationType"]>) {
  return TYPE_ICON_BG[t];
}
