import { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
  mobileListOpen: boolean;
  onMobileListOpenChange: (open: boolean) => void;
};

export function SlackWorkspaceLayout({ sidebar, main, mobileListOpen, onMobileListOpenChange }: Props) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      {/* Desktop rail */}
      <aside className="hidden lg:flex w-[min(100%,360px)] min-w-[280px] max-w-[400px] shrink-0 flex-col border-r border-border/60 bg-muted/30 dark:bg-muted/20">
        <div className="px-3 py-3 border-b border-border/60">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Workspace · Slack
          </p>
          <p className="text-[10px] mt-0.5 text-muted-foreground/70">
            Conversaciones, canales y mensajes directos
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileListOpen} onOpenChange={onMobileListOpenChange}>
        <SheetContent
          side="left"
          className="w-[min(100vw,380px)] sm:max-w-[380px] p-0 flex flex-col bg-card border-border/60"
        >
          <SheetHeader className="px-4 py-3 border-b border-border/60 text-left space-y-0">
            <SheetTitle className="text-sm font-semibold text-foreground">
              Conversaciones
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
        </SheetContent>
      </Sheet>

      {/* Main panel */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-card">{main}</div>
    </div>
  );
}
