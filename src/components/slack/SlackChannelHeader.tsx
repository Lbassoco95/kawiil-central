import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell, BellOff, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  channelId: string;
  showHash?: boolean;
  isWatching: boolean;
  onWatchChange: (v: boolean) => void;
  watchPending: boolean;
  onOpenSidebar?: () => void;
  showSidebarTrigger?: boolean;
};

export function SlackChannelHeader({
  title,
  channelId,
  showHash,
  isWatching,
  onWatchChange,
  watchPending,
  onOpenSidebar,
  showSidebarTrigger,
}: Props) {
  return (
    <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border/80 bg-card/40 backdrop-blur-sm">
      <div className="flex items-center gap-2 min-w-0">
        {showSidebarTrigger && onOpenSidebar && (
          <Button type="button" variant="ghost" size="icon" className="shrink-0 lg:hidden h-8 w-8" onClick={onOpenSidebar}>
            <PanelLeft className="h-4 w-4" />
            <span className="sr-only">Abrir lista de conversaciones</span>
          </Button>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground truncate flex items-center gap-1">
            {showHash && <span className="text-muted-foreground font-normal">#</span>}
            <span>{title}</span>
          </h2>
          <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[min(100%,280px)] sm:max-w-md">
            {channelId}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isWatching ? (
          <Bell className="h-4 w-4 text-primary hidden sm:block" />
        ) : (
          <BellOff className="h-4 w-4 text-muted-foreground hidden sm:block" />
        )}
        <Switch
          id="slack-watch"
          checked={isWatching}
          disabled={watchPending}
          onCheckedChange={onWatchChange}
        />
        <Label htmlFor="slack-watch" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
          Avisos
        </Label>
      </div>
    </header>
  );
}
