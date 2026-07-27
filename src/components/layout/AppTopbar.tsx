import { Menu, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentProfile, getFirstName, getGreeting } from "@/hooks/useCurrentProfile";
import { useIsMobile } from "@/hooks/use-mobile";
import { openCommandPalette } from "@/lib/openCommandPalette";
import { openMobileSidebar } from "@/lib/openMobileSidebar";
import { cn } from "@/lib/utils";
import { TopbarWidgets } from "./TopbarWidgets";
import { RealtimeStatusIndicator } from "./RealtimeStatusIndicator";
import { JornadaTopbarWidget } from "@/components/rh/JornadaTopbarWidget";
import { JornadaReminders } from "@/components/rh/JornadaReminders";
import { TooltipProvider } from "@/components/ui/tooltip";

interface AppTopbarProps {
  isFullWidth?: boolean;
}

export function AppTopbar({ isFullWidth = false }: AppTopbarProps) {
  const { user } = useAuth();
  const { data: profile } = useCurrentProfile();
  const isMobile = useIsMobile();

  const firstName = getFirstName(profile, user?.email);
  const greeting = getGreeting();

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div
      className={cn(
        "sticky top-0 z-30 shrink-0 border-b border-border/50 bg-background/85 backdrop-blur-md",
        isMobile ? "px-3 py-2" : "px-6 py-3",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-4",
          isFullWidth ? "w-full max-w-none px-0" : "max-w-7xl mx-auto",
        )}
      >
        {isMobile && (
          <button
            type="button"
            onClick={openMobileSidebar}
            aria-label="Abrir menú"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight text-foreground sm:text-base md:text-[17px]">
            {greeting},{" "}
            <span className="text-primary">{firstName}</span>{" "}
            <span
              className="kw-ai-wave inline-block align-baseline"
              role="img"
              aria-label="saludando"
            >
              👋
            </span>
            {!isMobile && (
              <span className="ml-2 font-normal text-muted-foreground">
                · ¿qué quieres avanzar hoy?
              </span>
            )}
          </h1>
        </div>

        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Abrir buscador global"
          className={cn(
            "group relative inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted",
            isMobile ? "h-9 w-9 justify-center px-0" : "min-w-[260px] justify-between",
          )}
        >
          <span className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" />
            {!isMobile && <span>Buscar en Kawiil…</span>}
          </span>
          {!isMobile && (
            <kbd className="ml-2 rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {modKey}K
            </kbd>
          )}
        </button>

        <JornadaTopbarWidget />
        <JornadaReminders />

        <TooltipProvider delayDuration={150}>
          <RealtimeStatusIndicator />
        </TooltipProvider>

        <TopbarWidgets />
      </div>
    </div>
  );
}
