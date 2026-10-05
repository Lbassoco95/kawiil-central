import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AlertTriangle, FileText, FolderOpen, Home, LogOut, MessageSquare, UserCircle } from "lucide-react";
import { usePortal } from "../lib/session";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../lib/demo";
import { db } from "../lib/supabase";
import { cn } from "@/lib/utils";

export default function Layout() {
  const { me, active, setActive } = usePortal();
  const navigate = useNavigate();
  const premier = me?.tier === "premier";
  const demo = isPortalDemoMode();
  const nav = [
    { to: "/", label: "Inicio", Icon: Home, show: active?.role !== "operativo" },
    { to: "/facturas", label: "Facturas", Icon: FileText, show: true },
    { to: "/documentos", label: "Documentos", Icon: FolderOpen, show: premier },
    { to: "/alertas", label: "Alertas", Icon: AlertTriangle, show: true },
    { to: "/mensajes", label: "Mensajes", Icon: MessageSquare, show: true },
    { to: "/cuenta", label: "Cuenta", Icon: UserCircle, show: true },
  ].filter((n) => n.show);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:p-2 focus:shadow">
        Saltar al contenido
      </a>
      {demo && (
        <div className="kw-demo-banner" role="status">
          Entorno de demostración · {DEMO_FISCAL_MARK}
        </div>
      )}
      <header
        className="sticky top-0 z-30 border-b border-sidebar-border bg-sidebar text-sidebar-foreground"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/images/kawiil-logo.png" alt="" className="h-8 w-8 brightness-0 invert" />
            <span className="text-lg font-semibold tracking-tight text-sidebar-accent-foreground" aria-label="Kawiil">
              KAWIIL
            </span>
            {demo && (
              <span className="rounded-md border border-sidebar-primary/50 bg-sidebar-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-primary">
                DEMO
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {(me?.clients?.length ?? 0) > 1 ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Cliente con el que trabaja</span>
                <select
                  className="max-w-[12rem] rounded-md border border-sidebar-border bg-sidebar-accent px-2 py-1 text-sm text-sidebar-accent-foreground"
                  value={active?.client_id ?? ""}
                  onChange={(e) => setActive(e.target.value)}
                >
                  {me!.clients!.map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {c.client_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="max-w-[12rem] truncate text-sm text-sidebar-foreground">{active?.client_name}</span>
            )}
            <button
              type="button"
              className="rounded-md p-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={async () => {
                await db.auth.signOut();
                navigate("/ingresar");
              }}
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <nav aria-label="Secciones" className="hidden border-t border-sidebar-border/80 md:block">
          <ul className="mx-auto flex max-w-5xl gap-1 px-4">
            {nav.map(({ to, label, Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                      isActive
                        ? "border-sidebar-primary font-semibold text-sidebar-accent-foreground"
                        : "border-transparent text-sidebar-foreground opacity-90 hover:text-sidebar-accent-foreground",
                    )
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:pb-8">
        <Outlet />
      </main>
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
          {nav.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                    isActive ? "font-semibold text-primary" : "text-muted-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span>{label}</span>
                    {isActive && <span className="sr-only">(actual)</span>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
