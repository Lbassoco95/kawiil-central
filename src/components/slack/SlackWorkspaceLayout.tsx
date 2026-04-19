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
    <div
      className="flex h-full min-h-0 w-full flex-1 border-t"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {/* Desktop rail */}
      <aside
        className="hidden lg:flex w-[min(100%,380px)] min-w-[300px] max-w-[420px] shrink-0 flex-col border-r"
        style={{
          background: "hsl(var(--sidebar-background))",
          color: "hsl(var(--sidebar-foreground))",
          borderColor: "hsl(var(--sidebar-foreground) / 0.12)",
        }}
      >
        <div
          className="px-3 py-3 border-b"
          style={{ borderColor: "hsl(var(--sidebar-foreground) / 0.12)" }}
        >
          <p className="text-xs font-semibold tracking-tight" style={{ color: "hsl(var(--sidebar-foreground))" }}>
            Workspace
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}>
            Mensajes de Slack
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileListOpen} onOpenChange={onMobileListOpenChange}>
        <SheetContent
          side="left"
          className="w-[min(100vw,380px)] sm:max-w-[380px] p-0 flex flex-col"
          style={{
            background: "hsl(var(--sidebar-background))",
            color: "hsl(var(--sidebar-foreground))",
            borderColor: "hsl(var(--sidebar-foreground) / 0.12)",
          }}
        >
          <SheetHeader
            className="px-4 py-3 border-b text-left space-y-0"
            style={{ borderColor: "hsl(var(--sidebar-foreground) / 0.12)" }}
          >
            <SheetTitle className="text-sm font-semibold" style={{ color: "hsl(var(--sidebar-foreground))" }}>
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
