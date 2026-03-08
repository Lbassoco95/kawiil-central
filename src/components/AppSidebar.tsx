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
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserRole } from "@/hooks/useUserRole";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Proyectos", url: "/proyectos", icon: FolderKanban },
  { title: "Tareas", url: "/tareas", icon: CheckSquare },
  { title: "Calendario", url: "/microsoft365/calendario", icon: Calendar },
  { title: "Correo", url: "/microsoft365/correo", icon: Mail },
  { title: "Documentos", url: "/documentos", icon: FileText },
  { title: "Notificaciones", url: "/notificaciones", icon: Bell },
  { title: "Despacho", url: "/despacho", icon: Building2 },
  { title: "Kawiil AI", url: "/asistente", icon: Sparkles },
  { title: "Administración", url: "/admin", icon: Settings },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { signOut, user } = useAuth();
  const isMobile = useIsMobile();
  const { isAdminOrManager } = useUserRole();

  const visibleNavItems = navItems.filter(
    (item) => item.url !== "/admin" || isAdminOrManager
  );

  useEffect(() => {
    setMobileOpen(false);
  }, []);

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
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
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

          <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
            {visibleNavItems.map((item) => (
              <NavLink
                key={item.url}
                to={item.url}
                end={item.url === "/"}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                onClick={() => setMobileOpen(false)}
              >
                <item.icon className="h-[15px] w-[15px] shrink-0 opacity-70" />
                <span>{item.title}</span>
              </NavLink>
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
              <LogOut className="h-[15px] w-[15px] shrink-0 opacity-70" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </aside>
      </>
    );
  }

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border/50 transition-all duration-200 h-screen sticky top-0",
        collapsed ? "w-14" : "w-56"
      )}
    >
      <div className="flex items-center gap-2.5 px-3.5 h-14 border-b border-sidebar-border/50">
        <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-7 w-7" />
        {!collapsed && (
          <span className="font-semibold text-sidebar-accent-foreground text-sm tracking-tight">
            Kawiil OS
          </span>
        )}
      </div>

      <nav className="flex-1 py-2 px-1.5 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.url}
            to={item.url}
            end={item.url === "/"}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              collapsed && "justify-center px-1.5"
            )}
            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          >
            <item.icon className="h-[15px] w-[15px] shrink-0 opacity-70" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-sidebar-border/50 p-1.5 space-y-0.5">
        {!collapsed && user && (
          <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/60 truncate">
            {user.email}
          </div>
        )}
        <button
          onClick={signOut}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] w-full transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-1.5"
          )}
        >
          <LogOut className="h-[15px] w-[15px] shrink-0 opacity-70" />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] w-full transition-colors text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-1.5"
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-[15px] w-[15px] shrink-0 opacity-70" />
          ) : (
            <>
              <ChevronLeft className="h-[15px] w-[15px] shrink-0 opacity-70" />
              <span>Colapsar</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
