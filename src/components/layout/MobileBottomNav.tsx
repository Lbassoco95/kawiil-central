import { NavLink, useLocation } from "react-router-dom";
import { Bell, CheckSquare, LayoutDashboard, Menu, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnreadCount } from "@/hooks/useMentionNotifications";
import { openMobileSidebar } from "@/lib/openMobileSidebar";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
  exact?: boolean;
};

/**
 * Bottom navigation para móvil (v2.4). Sólo se renderiza en pantallas <md.
 * Los íconos prioritarios son Dashboard, Tareas, Asistente IA, Notificaciones,
 * y el botón "Más" abre el drawer del sidebar completo.
 */
export function MobileBottomNav() {
  const { data: notifCount = 0 } = useUnreadCount();
  const location = useLocation();

  const items: NavItem[] = [
    { to: "/", label: "Inicio", icon: LayoutDashboard, exact: true },
    { to: "/tareas", label: "Tareas", icon: CheckSquare },
    { to: "/asistente", label: "Kawiil", icon: Sparkles },
    { to: "/notificaciones", label: "Avisos", icon: Bell, badge: notifCount },
  ];

  return (
    <nav
      className={cn(
        "md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-md",
        "pb-[env(safe-area-inset-bottom)]",
      )}
      aria-label="Navegación principal móvil"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? location.pathname === item.to
            : location.pathname === item.to || location.pathname.startsWith(item.to + "/");
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.exact}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
                  {item.badge != null && item.badge > 0 && (
                    <span className="absolute -right-2 -top-1.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </span>
                <span className="leading-none">{item.label}</span>
                {isActive && (
                  <span className="absolute inset-x-6 top-0 h-[2px] rounded-b bg-primary" />
                )}
              </NavLink>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={openMobileSidebar}
            className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Abrir menú completo"
          >
            <Menu className="h-5 w-5" strokeWidth={2} />
            <span className="leading-none">Más</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
