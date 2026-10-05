import { NavLink } from "@/components/NavLink";
import {
  BookOpen,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  FileText,
  FolderKanban,
  Kanban,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Bell,
  PanelLeftClose,
  PanelLeftOpen,
  PartyPopper,
  Search,
  Settings,
  Sparkles,
  UserCog,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { useUserRole } from "@/hooks/useUserRole";
import { useUnreadCount } from "@/hooks/useMentionNotifications";
import { useUnreadEmailCount } from "@/hooks/useMicrosoft";
import { useSlackChannelNotificationBadges } from "@/hooks/useSlackChannelNotificationBadges";
import { useAuth } from "@/contexts/AuthContext";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { openCommandPalette } from "@/lib/openCommandPalette";
import { OPEN_MOBILE_SIDEBAR_EVENT } from "@/lib/openMobileSidebar";
import { SidebarFooter } from "@/components/sidebar/SidebarFooter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type NavItem = {
  title: string;
  url: string;
  icon: any;
  /** Slot key used by .kw-sb-link[data-view-link] for color theming. */
  view: string;
  moduleKey?: string;
  tooltip?: string;
  /** Solo visible para G4 (rol transformador). */
  g4Only?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Trabajo",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard, view: "dashboard" },
      { title: "Tareas", url: "/tareas", icon: CheckSquare, view: "tareas" },
      { title: "Proyectos", url: "/proyectos", icon: FolderKanban, view: "proyectos" },
      {
        title: "Juntas",
        url: "/juntas",
        icon: CalendarClock,
        view: "juntas",
        tooltip: "Múuch': sesiones, grabaciones, minutas IA y acuerdos → tareas",
      },
      { title: "Actividades", url: "/actividades", icon: PartyPopper, view: "actividades", g4Only: true },
      { title: "Calendario", url: "/microsoft365/calendario", icon: Calendar, view: "calendario", moduleKey: "calendario" },
      { title: "Clientes", url: "/clientes", icon: Users, view: "clientes" },
    ],
  },
  {
    label: "Operación",
    items: [
      { title: "Pipeline", url: "/pipeline", icon: Kanban, view: "pipeline", moduleKey: "pipeline" },
      { title: "Recursos Humanos", url: "/rh", icon: UserCog, view: "rh", moduleKey: "hub", tooltip: "Jornada, expediente, reclutamiento, cuestionarios y tablero CHRO" },
      { title: "Documentos", url: "/documentos", icon: FileText, view: "documentos" },
      { title: "Finanzas", url: "/finanzas", icon: Wallet, view: "finanzas", moduleKey: "finanzas" },
    ],
  },
  {
    label: "Comunicación",
    items: [
      { title: "Correo", url: "/microsoft365/correo", icon: Mail, view: "correo", moduleKey: "correo" },
      { title: "Slack", url: "/comunicacion", icon: MessageSquare, view: "slack", tooltip: "Mensajes y canales del workspace" },
      { title: "Notificaciones", url: "/notificaciones", icon: Bell, view: "notificaciones" },
    ],
  },
  {
    label: "Conocimiento",
    items: [
      { title: "Asistente IA", url: "/asistente", icon: Sparkles, view: "asistente", moduleKey: "ai" },
      { title: "Conocimiento", url: "/conocimiento", icon: BookOpen, view: "conocimiento", moduleKey: "conocimiento" },
      { title: "Hub", url: "/hub", icon: Building2, view: "hub", moduleKey: "hub" },
      {
        title: "Plantillas contables",
        url: "/contabilidad/plantillas",
        icon: FileText,
        view: "plantillas",
        tooltip: "Plantillas de correos del área contable (ISN/IMSS, provisionales, nóminas, anuales)",
      },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Configuración", url: "/configuracion", icon: Settings, view: "config", moduleKey: "admin" },
    ],
  },
];

type BadgeKind = "danger" | "ok" | "ai";

function Badge({ count, kind = "danger" }: { count: number; kind?: BadgeKind }) {
  if (count <= 0) return null;
  return (
    <span className={cn("kw-sb-badge", kind === "ok" && "ok", kind === "ai" && "ai")}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function useNavBadges() {
  const { user } = useAuth();
  const { data: notifCount = 0 } = useUnreadCount();
  const { data: emailCount = 0 } = useUnreadEmailCount();
  const slackChannelBadges = useSlackChannelNotificationBadges(user?.id);
  const slackUnread = Object.values(slackChannelBadges).reduce((s, n) => s + n, 0);

  const counts: Record<string, { count: number; kind: BadgeKind }> = {
    "/notificaciones": { count: notifCount, kind: "danger" },
    "/microsoft365/correo": { count: emailCount, kind: "danger" },
    "/comunicacion": { count: slackUnread, kind: "danger" },
  };
  return (url: string) => counts[url] ?? { count: 0, kind: "danger" as BadgeKind };
}

function NavItemRow({
  item,
  collapsed,
  badge,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  badge: { count: number; kind: BadgeKind };
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <ActiveAwareWrapper item={item} collapsed={collapsed}>
      <NavLink
        to={item.url}
        end={item.url === "/"}
        data-view-link={item.view}
        data-collapsed={collapsed ? "true" : "false"}
        data-has-badge={badge.count > 0 ? "true" : "false"}
        className={cn("kw-sb-link", collapsed && "justify-center px-2")}
        activeClassName="kw-sb-link-active"
        onClick={onNavigate}
      >
        <Icon className="kw-ico h-[17px] w-[17px] shrink-0" />
        {!collapsed && <span className="flex-1 truncate">{item.title}</span>}
        {!collapsed && <Badge count={badge.count} kind={badge.kind} />}
      </NavLink>
    </ActiveAwareWrapper>
  );
}

/** Wraps the link in a Tooltip when collapsed (or when a tooltip is configured). */
function ActiveAwareWrapper({
  item,
  collapsed,
  children,
}: {
  item: NavItem;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{children as any}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs max-w-[240px]">
          {item.tooltip ? (
            <>
              <span className="block font-medium">{item.title}</span>
              <span className="font-normal text-muted-foreground">{item.tooltip}</span>
            </>
          ) : (
            item.title
          )}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (item.tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{children as any}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs max-w-[260px]">
          {item.tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }
  return <>{children}</>;
}

function SidebarBody({
  collapsed,
  toggle,
  onMobileNavigate,
}: {
  collapsed: boolean;
  toggle: () => void;
  onMobileNavigate?: () => void;
}) {
  const { hasModule, isError: modulesError, refetch: refetchModules } = useModulePermissions();
  const { isTransformador } = useUserRole();
  const getBadge = useNavBadges();

  const visibleGroups = NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => (!i.moduleKey || hasModule(i.moduleKey)) && (!i.g4Only || isTransformador),
      ),
    }))
    .filter((g) => g.items.length > 0);

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-3.5 py-3",
          collapsed && "justify-center px-2",
        )}
        style={{ borderColor: "var(--sb-border)" }}
      >
        <div className="kw-sb-brand-mark" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[14px] font-bold tracking-tight" style={{ color: "var(--sb-fg)" }}>
              Kawiil
            </div>
            <div
              className="text-[10px] font-medium uppercase tracking-[0.14em]"
              style={{ color: "var(--sb-fg-faint)" }}
            >
              OS · v2
            </div>
          </div>
        )}
        {!collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                className="kw-sb-iconbtn ml-auto"
                aria-label="Colapsar sidebar"
              >
                <PanelLeftClose className="h-[15px] w-[15px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Colapsar</TooltipContent>
          </Tooltip>
        )}
      </div>

      {modulesError && !collapsed && (
        <div className="mx-2.5 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-200">
          No se pudieron cargar tus permisos de módulos (API lenta o caída).{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void refetchModules()}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Search trigger */}
      <div className={cn("px-2.5 pt-2.5 pb-1", collapsed && "px-1.5")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openCommandPalette}
                className="kw-sb-iconbtn mx-auto"
                aria-label="Buscar"
              >
                <Search className="h-[15px] w-[15px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Buscar <span className="ml-2 text-muted-foreground">{modKey}K</span>
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={openCommandPalette}
            className="kw-sb-search relative pl-9"
          >
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--sb-fg-faint)" }}
            />
            Buscar en Kawiil…
            <kbd
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded border px-1.5 py-0.5 text-[10px] font-medium"
              style={{ borderColor: "var(--sb-border)", color: "var(--sb-fg-faint)" }}
            >
              {modKey}K
            </kbd>
          </button>
        )}
      </div>

      {/* Nav groups */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto",
          collapsed ? "px-1.5 pb-2 pt-1" : "px-2 pb-2",
        )}
      >
        {visibleGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && <div className="kw-sb-group">{group.label}</div>}
            {collapsed && (
              <div className="my-1 border-t" style={{ borderColor: "var(--sb-border)" }} />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemRow
                  key={item.url}
                  item={item}
                  collapsed={collapsed}
                  badge={getBadge(item.url)}
                  onNavigate={onMobileNavigate}
                />
              ))}
            </div>
          </div>
        ))}
        {/* Collapsed expand toggle */}
        {collapsed && (
          <div className="mt-2 flex justify-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  className="kw-sb-iconbtn"
                  aria-label="Expandir sidebar"
                >
                  <PanelLeftOpen className="h-[15px] w-[15px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Expandir</TooltipContent>
            </Tooltip>
          </div>
        )}
      </nav>

      <SidebarFooter collapsed={collapsed} />
    </div>
  );
}

export function AppSidebar() {
  const { collapsed, toggle, setCollapsed } = useSidebarCollapsed();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!isMobile) return;
    const onOpen = () => setMobileOpen(true);
    window.addEventListener(OPEN_MOBILE_SIDEBAR_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MOBILE_SIDEBAR_EVENT, onOpen);
  }, [isMobile]);

  useEffect(() => {
    if (mobileOpen) setMobileOpen(false);
  }, [location.pathname]);

  if (isMobile) {
    return (
      <TooltipProvider delayDuration={200}>
        {mobileOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cn(
            "kw-sidebar fixed left-0 top-0 z-50 flex h-screen w-[268px] flex-col transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
            className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg text-[color:var(--sb-fg-dim)] hover:bg-[color:var(--sb-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
          <SidebarBody
            collapsed={false}
            toggle={() => setCollapsed(false)}
            onMobileNavigate={() => setMobileOpen(false)}
          />
        </aside>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "kw-sidebar sticky top-0 flex h-screen flex-col transition-[width] duration-200",
          collapsed ? "w-[60px]" : "w-[252px]",
        )}
      >
        <SidebarBody collapsed={collapsed} toggle={toggle} />
      </aside>
    </TooltipProvider>
  );
}
