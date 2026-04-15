import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, PanelLeft, Search, Info, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SlackMessage } from "@/lib/slackApi";
import { toast } from "sonner";

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

  return (
    <header className="shrink-0 z-10 flex flex-col gap-2 border-b border-border/70 bg-card px-4 py-3 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
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
          <div className="hidden sm:flex items-center gap-1 max-w-[200px]">
            <Input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Buscar…"
              className="h-8 text-xs"
            />
            <Button type="button" variant="secondary" size="icon" className="h-8 w-8 shrink-0" onClick={runSearch}>
              <Search className="h-3.5 w-3.5" />
            </Button>
          </div>
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
          {isWatching ? (
            <Bell className="h-4 w-4 text-primary hidden sm:block" aria-hidden />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground hidden sm:block" aria-hidden />
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
            className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
            title="Por defecto encendido en todos los canales; aquí solo silencias esta conversación."
          >
            Avisos
          </Label>
        </div>
      </div>
    </header>
  );
}
