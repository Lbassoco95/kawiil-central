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
    <div className="flex min-h-screen flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Saltar al contenido
      </a>
      {demo && (
        <div className="kw-demo-banner" role="status">
          Entorno de demostración · {DEMO_FISCAL_MARK}
        </div>
      )}
      <header className="sticky top-0 z-30 bg-accent text-accent-foreground" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="text-2xl font-bold" style={{ fontFamily: "Rajdhani" }} aria-label="Kawiil">KAWIIL</span>
          {demo && <span className="rounded border border-white/50 px-2 py-0.5 text-[11px] font-semibold tracking-wide">DEMO</span>}
          <div className="ml-auto flex items-center gap-2">
            {(me?.clients?.length ?? 0) > 1 ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Cliente con el que trabaja</span>
                <select
                  className="max-w-[12rem] rounded-md border border-white/40 bg-accent px-2 py-1 text-sm text-white"
                  value={active?.client_id ?? ""}
                  onChange={(e) => setActive(e.target.value)}
                >
                  {me!.clients!.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
                </select>
              </label>
            ) : (
              <span className="max-w-[12rem] truncate text-sm">{active?.client_name}</span>
            )}
            <button
              type="button"
              className="rounded-md p-2 hover:bg-white/10"
              onClick={async () => { await db.auth.signOut(); navigate("/ingresar"); }}
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <nav aria-label="Secciones" className="hidden border-t border-white/15 md:block">
          <ul className="mx-auto flex max-w-5xl gap-1 px-4">
            {nav.map(({ to, label, Icon }) => (
              <li key={to}>
                <NavLink to={to} end={to === "/"} className={({ isActive }) => cn("flex items-center gap-2 px-3 py-2 text-sm", isActive ? "border-b-2 border-white font-semibold" : "opacity-85 hover:opacity-100")}>
                  <Icon className="h-4 w-4" aria-hidden="true" />{label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:pb-8">
        <Outlet />
      </main>
      <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-30 border-t bg-white md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
          {nav.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink to={to} end={to === "/"} className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive ? "font-semibold text-accent" : "text-muted-foreground")}>
                {({ isActive }) => (<><Icon className="h-5 w-5" aria-hidden="true" /><span>{label}</span>{isActive && <span className="sr-only">(actual)</span>}</>)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
