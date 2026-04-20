import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  sidebar: ReactNode;
  main: ReactNode;
  mobileListOpen: boolean;
  onMobileListOpenChange: (open: boolean) => void;
  /** Nombre del workspace mostrado en la mini-cabecera. Default: "Kawiil". */
  workspaceName?: string;
  /** Inicial mostrada en el avatar del workspace. Default: primera letra de `workspaceName`. */
  workspaceInitial?: string;
  /** Stats compactas para mostrar bajo el nombre del workspace. */
  isConnected?: boolean;
  connectionLabel?: string;
  totalUnread?: number;
  totalConversations?: number;
  channelsCount?: number;
  directsCount?: number;
  /** CTA principal: redactar nuevo mensaje directo. */
  onNewMessage?: () => void;
};

/**
 * Layout v2.4 estilo Slack-nativo:
 * - Mini rail vertical a la izquierda con avatar del workspace.
 * - Sidebar oscuro con header workspace + buscador + lista de conversaciones (pasada como `sidebar`).
 * - Panel principal a la derecha (header de canal + mensajes + composer).
 *
 * Sustituye al PageHeader hero anterior para que la vista se sienta como una app
 * de mensajería full-screen y no como un dashboard con stats arriba.
 */
export function SlackWorkspaceLayout({
  sidebar,
  main,
  mobileListOpen,
  onMobileListOpenChange,
  workspaceName = "Kawiil",
  workspaceInitial,
  isConnected = false,
  connectionLabel,
  totalUnread = 0,
  totalConversations,
  channelsCount,
  directsCount,
  onNewMessage,
}: Props) {
  const initial = (workspaceInitial ?? workspaceName.charAt(0) ?? "K").toUpperCase();
  const unreadBadge = totalUnread > 0 ? (totalUnread > 99 ? "99+" : String(totalUnread)) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-slate-200/70 bg-card shadow-sm dark:border-slate-800/60">
      {/* Mini rail vertical de workspaces (estilo Slack-nativo). Solo desktop. */}
      <aside
        className="hidden lg:flex w-[60px] shrink-0 flex-col items-center gap-2 border-r border-slate-800/60 py-3"
        style={{
          background: "linear-gradient(180deg, hsl(222 47% 11%), hsl(222 47% 8%))",
        }}
        aria-label="Workspaces"
      >
        <button
          type="button"
          className="relative grid h-10 w-10 place-items-center rounded-xl text-white text-sm font-bold shadow-sm ring-2 ring-white/10 hover:ring-white/30 transition"
          style={{
            background: "linear-gradient(135deg, hsl(207 100% 42%), hsl(217 91% 60%))",
          }}
          title={workspaceName}
        >
          {initial}
          {unreadBadge && (
            <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white tabular-nums leading-none">
              {unreadBadge}
            </span>
          )}
        </button>
        {onNewMessage && (
          <button
            type="button"
            onClick={onNewMessage}
            className="grid h-9 w-9 place-items-center rounded-xl border border-dashed border-white/20 text-white/60 hover:border-white/50 hover:text-white transition"
            title="Nuevo mensaje directo"
            aria-label="Nuevo mensaje directo"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        <div className="mt-auto flex flex-col items-center gap-1 text-[9px] uppercase tracking-wider text-white/40">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isConnected ? "bg-emerald-400" : "bg-amber-400",
            )}
            title={isConnected ? "Slack conectado" : "Slack desconectado"}
          />
          <span className="rotate-180 [writing-mode:vertical-rl] hidden xl:block">
            {connectionLabel || (isConnected ? "OAuth" : "Off")}
          </span>
        </div>
      </aside>

      {/* Sidebar Slack: header workspace + lista de conversaciones (dark scope para contraste) */}
      <aside
        className="dark hidden lg:flex w-[min(100%,300px)] min-w-[260px] max-w-[340px] shrink-0 flex-col border-r border-slate-800/40 dark:border-slate-800/60 text-foreground"
        style={{
          background: "linear-gradient(180deg, hsl(222 38% 16%), hsl(222 38% 14%))",
        }}
      >
        <header className="flex items-center justify-between gap-2 px-3 py-3 border-b border-slate-800/50">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight text-white">{workspaceName}</p>
            <p className="mt-0.5 text-[10.5px] leading-tight text-white/60">
              {typeof totalConversations === "number"
                ? `${totalConversations} conversaciones · ${channelsCount ?? 0} canales · ${directsCount ?? 0} DM`
                : "Workspace · Slack"}
            </p>
          </div>
          {onNewMessage && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-white/80 hover:bg-white/10 hover:text-white"
              onClick={onNewMessage}
              title="Nuevo mensaje directo"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          )}
        </header>
        <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileListOpen} onOpenChange={onMobileListOpenChange}>
        <SheetContent
          side="left"
          className="dark w-[min(100vw,340px)] sm:max-w-[340px] p-0 flex flex-col border-slate-800/60 text-foreground"
          style={{
            background: "linear-gradient(180deg, hsl(222 38% 16%), hsl(222 38% 14%))",
          }}
        >
          <SheetHeader className="px-4 py-3 border-b border-slate-800/50 text-left space-y-0">
            <SheetTitle className="text-sm font-semibold text-white">
              {workspaceName}
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
