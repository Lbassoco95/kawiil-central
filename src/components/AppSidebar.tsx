import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CheckSquare,
  FileText,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Calendar,
  Mail,
  Building2,
  Bell,
  Sparkles,
  Wallet,
  BookOpen,
  Kanban,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { useUnreadCount } from "@/hooks/useMentionNotifications";
import { useUnreadEmailCount } from "@/hooks/useMicrosoft";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type NavItem = { title: string; url: string; icon: any; moduleKey?: string };
type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Inicio",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "Trabajo",
    items: [
      { title: "Clientes", url: "/clientes", icon: Users },
      { title: "Proyectos", url: "/proyectos", icon: FolderKanban },
      { title: "Tareas", url: "/tareas", icon: CheckSquare },
      { title: "Pipeline", url: "/pipeline", icon: Kanban, moduleKey: "pipeline" },
      { title: "Documentos", url: "/documentos", icon: FileText },
    ],
  },
  {
    label: "Integraciones",
    items: [
      { title: "Calendario", url: "/microsoft365/calendario", icon: Calendar, moduleKey: "calendario" },
      { title: "Correo", url: "/microsoft365/correo", icon: Mail, moduleKey: "correo" },
      { title: "Comunicación", url: "/comunicacion", icon: MessageSquare },
      { title: "Notificaciones", url: "/notificaciones", icon: Bell },
    ],
  },
  {
    label: "Inteligencia",
    items: [
      { title: "Kawiil AI", url: "/asistente", icon: Sparkles, moduleKey: "ai" },
      { title: "Conocimiento", url: "/conocimiento", icon: BookOpen, moduleKey: "conocimiento" },
    ],
  },
  {
    label: "Gestión",
    items: [
      { title: "Hub", url: "/hub", icon: Building2, moduleKey: "hub" },
      { title: "Finanzas", url: "/finanzas", icon: Wallet, moduleKey: "finanzas" },
      { title: "Administración", url: "/admin", icon: Settings, moduleKey: "admin" },
    ],
  },
];

function BadgeCount({ count, variant = "primary" }: { count: number; variant?: "primary" | "destructive" }) {
  if (count <= 0) return null;
  const bg = variant === "destructive" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground";
  return (
    <span className={cn(bg, "text-[10px] rounded-full px-1.5 py-0 font-bold leading-4 animate-pulse-soft")}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function BadgeDot({ variant = "primary" }: { variant?: "primary" | "destructive" }) {
  const bg = variant === "destructive" ? "bg-destructive" : "bg-primary";
  return <span className={cn("absolute -top-1 -right-1 h-2 w-2 rounded-full animate-pulse-soft", bg)} />;
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { signOut, user } = useAuth();
  const isMobile = useIsMobile();
  const { hasModule } = useModulePermissions();
  const { data: unreadCount = 0 } = useUnreadCount();
  const { data: unreadEmailCount = 0 } = useUnreadEmailCount();

  const visibleGroups = navGroups.map((g) => ({
    ...g,
    items: g.items.filter((item) => {
      if (item.moduleKey && !hasModule(item.moduleKey)) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);

  const getBadge = (url: string, showFull: boolean) => {
    if (url === "/notificaciones" && unreadCount > 0) {
      return showFull ? <BadgeCount count={unreadCount} /> : <BadgeDot />;
    }
    if (url === "/microsoft365/correo" && unreadEmailCount > 0) {
      return showFull ? <BadgeCount count={unreadEmailCount} variant="destructive" /> : <BadgeDot variant="destructive" />;
    }
    return null;
  };

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 left-3 z-50 flex items-center justify-center h-9 w-9 rounded-lg bg-sidebar text-sidebar-foreground shadow-md"
          aria-label="Abrir menú"
        >
          <Menu className="h-4 w-4" />
        </button>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cn(
            "fixed top-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground h-screen w-64 transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border/50">
            <div className="flex items-center gap-2.5">
              <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-7 w-7" />
              <span className="font-semibold text-sidebar-accent-foreground text-sm tracking-tight">
                Kawiil OS
              </span>
            </div>
            <button onClick={() => setMobileOpen(false)} aria-label="Cerrar menú">
              <X className="h-4 w-4 text-sidebar-foreground" />
            </button>
          </div>

          <nav className="flex-1 py-2 px-2 overflow-y-auto">
            {visibleGroups.map((group, gi) => (
              <div key={group.label}>
                {gi > 0 && <div className="h-px bg-sidebar-border/30 mx-2 my-2" />}
                <p className="text-[10px] font-medium text-sidebar-foreground/40 uppercase tracking-wider px-2.5 mb-1 mt-1">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.url}
                      to={item.url}
                      end={item.url === "/"}
                      className="relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-all text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
                      onClick={() => setMobileOpen(false)}
                    >
                      <item.icon className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="flex-1">{item.title}</span>
                      {getBadge(item.url, true)}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-sidebar-border/50 p-2 space-y-0.5">
            {user && (
              <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/60 truncate">
                {user.email}
              </div>
            )}
            <button
              onClick={() => { signOut(); setMobileOpen(false); }}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] w-full transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4 shrink-0 opacity-70" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </aside>
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border/50 transition-all duration-200 h-screen sticky top-0",
          collapsed ? "w-14" : "w-56"
        )}
      >
        <div className="flex items-center gap-2.5 px-3.5 h-14 border-b border-sidebar-border/50">
          <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-7 w-7 shrink-0" />
          {!collapsed && (
            <span className="font-semibold text-sidebar-accent-foreground text-sm tracking-tight">
              Kawiil OS
            </span>
          )}
        </div>

        <nav className="flex-1 py-2 px-1.5 overflow-y-auto">
          {visibleGroups.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <div className="h-px bg-sidebar-border/30 mx-1.5 my-2" />}
              {!collapsed && (
                <p className="text-[10px] font-medium text-sidebar-foreground/40 uppercase tracking-wider px-2.5 mb-1 mt-1">{group.label}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const linkContent = (
                    <NavLink
                      key={item.url}
                      to={item.url}
                      end={item.url === "/"}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-all text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground group",
                        collapsed && "justify-center px-1.5"
                      )}
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-full before:bg-sidebar-primary [&_svg]:scale-110"
                    >
                      <span className="relative shrink-0 transition-transform duration-150 group-hover:scale-105">
                        <item.icon className="h-4 w-4 opacity-70" />
                        {collapsed && getBadge(item.url, false)}
                      </span>
                      {!collapsed && <span className="flex-1">{item.title}</span>}
                      {!collapsed && getBadge(item.url, true)}
                    </NavLink>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={item.url}>
                        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          {item.title}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return linkContent;
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border/50 p-1.5 space-y-0.5">
          {!collapsed && user && (
            <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/60 truncate">
              {user.email}
            </div>
          )}

          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={signOut}
                  className="flex items-center justify-center rounded-lg px-1.5 py-[7px] text-[13px] w-full transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                >
                  <LogOut className="h-4 w-4 shrink-0 opacity-70" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Cerrar sesión</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={signOut}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] w-full transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4 shrink-0 opacity-70" />
              <span>Cerrar sesión</span>
            </button>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] w-full transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              collapsed && "justify-center px-1.5"
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0 opacity-70" />
                <span>Colapsar</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
