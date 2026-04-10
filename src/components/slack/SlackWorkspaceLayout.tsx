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
    <div className="flex w-full min-h-[calc(100vh-3.5rem)] border-t border-border/50">
      {/* Desktop rail */}
      <aside className="hidden lg:flex w-[280px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="px-3 py-3 border-b border-sidebar-border/60">
          <p className="text-xs font-semibold text-sidebar-accent-foreground tracking-tight">Workspace</p>
          <p className="text-[10px] text-sidebar-foreground/55 mt-0.5">Mensajes de Slack</p>
        </div>
        <div className="flex-1 min-h-0">{sidebar}</div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileListOpen} onOpenChange={onMobileListOpenChange}>
        <SheetContent side="left" className="w-[300px] p-0 flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border">
          <SheetHeader className="px-4 py-3 border-b border-sidebar-border/60 text-left space-y-0">
            <SheetTitle className="text-sm font-semibold text-sidebar-accent-foreground">Conversaciones</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
        </SheetContent>
      </Sheet>

      {/* Main panel */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">{main}</div>
    </div>
  );
}
