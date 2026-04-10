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
    <div className="flex w-full h-full min-h-0 flex-1 border-t border-border/50">
      {/* Desktop rail */}
      <aside className="hidden lg:flex w-[min(100%,380px)] min-w-[300px] max-w-[420px] shrink-0 flex-col border-r border-zinc-800 bg-[#1a1d21] text-zinc-100">
        <div className="px-3 py-3 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-200 tracking-tight">Workspace</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">Mensajes de Slack</p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileListOpen} onOpenChange={onMobileListOpenChange}>
        <SheetContent side="left" className="w-[min(100vw,380px)] sm:max-w-[380px] p-0 flex flex-col bg-[#1a1d21] text-zinc-100 border-zinc-800">
          <SheetHeader className="px-4 py-3 border-b border-zinc-800 text-left space-y-0">
            <SheetTitle className="text-sm font-semibold text-zinc-200">Conversaciones</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
        </SheetContent>
      </Sheet>

      {/* Main panel */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">{main}</div>
    </div>
  );
}
