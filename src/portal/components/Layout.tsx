import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, LogOut, Menu, Moon, MoreHorizontal, Sun, X } from "lucide-react";
import { usePortal } from "../lib/session";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../lib/demo";
import { db } from "../lib/supabase";
import { ALL_NAV, MORE_NAV, PRIMARY_NAV } from "../lib/nav";
import { LOGO } from "../design/assets";
import { GlassPanel, IconBadge, KawiilitoDock, SourceChip } from "../design/primitives";
import { useTheme } from "../design/ThemeProvider";
import { isDesignPreview } from "../lib/designPreview";
import { portalPath } from "../lib/basePath";
import DemoToastHost from "./DemoToast";
import DemoModal from "./DemoModal";

const SIDE_KEY = "kawiil-os-demo-sidebar-collapsed";

export default function Layout() {
  const { me, active, setActive } = usePortal();
  const navigate = useNavigate();
  const demo = isPortalDemoMode() || isDesignPreview();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [originOpen, setOriginOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const href = (to: string) => portalPath(to);

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  /** En /diseno: sin documentos/alertas/cuenta; Facturación apunta a la vista demo de solicitudes. */
  const designHidden = new Set(["/documentos", "/alertas", "/cuenta"]);
  const resolveNav = (n: (typeof ALL_NAV)[number]) =>
    isDesignPreview() && n.to === "/facturas" ? { ...n, to: "/facturacion" } : n;
  const navItems = ALL_NAV.filter((n) => !(isDesignPreview() && designHidden.has(n.to))).map(resolveNav);
  const moreItems = [...PRIMARY_NAV.slice(4), ...MORE_NAV]
    .filter((n) => !(isDesignPreview() && designHidden.has(n.to)))
    .map(resolveNav);

  return (
    <div className={`kw-shell${collapsed ? " kw-shell--side-collapsed" : ""}`}>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:p-2 focus:shadow"
      >
        Saltar al contenido
      </a>
      {demo && (
        <div className="kw-demo-banner" role="status">
          Entorno de demostración · {DEMO_FISCAL_MARK}
        </div>
      )}

      <header className="kw-header">
        <GlassPanel padded={false} size="xl" className="kw-header__bar" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}>
          <div className="kw-header__inner">
            <button
              type="button"
              className="kw-iconbtn kw-header__menu"
              aria-label="Abrir menú"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={18} strokeWidth={1.75} />
            </button>
            <div className="kw-header__brand">
              <img className="logo-light" src={LOGO.wordBlue} alt="Kawiil Mx" />
              <img className="logo-dark" src={LOGO.wordWhite} alt="Kawiil Mx" />
              {demo && <span className="kw-caption">DEMO</span>}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <SourceChip source="sat" label="SAT al día" via="ejemplo" onClick={() => setOriginOpen(true)} />
              {(me?.clients?.length ?? 0) > 1 ? (
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Cliente</span>
                  <select
                    className="kw-field"
                    style={{ minHeight: 40, width: "auto", maxWidth: "10rem" }}
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
                <span className="kw-small max-w-[10rem] truncate">{active?.client_name || "Cliente demo"}</span>
              )}
              <button type="button" className="kw-iconbtn" onClick={toggle} aria-label={theme === "light" ? "Activar modo oscuro" : "Activar modo claro"}>
                {theme === "light" ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
              </button>
              {!isDesignPreview() && (
                <button
                  type="button"
                  className="kw-iconbtn"
                  onClick={async () => {
                    await db.auth.signOut();
                    navigate("/ingresar");
                  }}
                  aria-label="Cerrar sesión"
                >
                  <LogOut size={16} strokeWidth={1.75} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </GlassPanel>
      </header>

      <div className="kw-shell__body">
        <aside className={`kw-side${collapsed ? " kw-side--collapsed" : ""}`} aria-label="Navegación">
          <GlassPanel padded={false} className="kw-side__panel">
            <div className="kw-side__top">
              {!collapsed ? <p className="kw-caption">Kawiil OS</p> : <span className="sr-only">Kawiil OS</span>}
              <button
                type="button"
                className="kw-iconbtn"
                aria-label={collapsed ? "Expandir menú lateral" : "Colapsar menú lateral"}
                aria-pressed={collapsed}
                onClick={() => setCollapsed((v) => !v)}
              >
                {collapsed ? <ChevronRight size={16} strokeWidth={1.75} /> : <ChevronLeft size={16} strokeWidth={1.75} />}
              </button>
            </div>
            <nav className="kw-side__nav">
              {navItems.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={href(to)}
                  end={to === "/"}
                  className="kw-side__link"
                  title={label}
                  aria-label={label}
                >
                  {({ isActive }) => (
                    <>
                      <IconBadge icon={Icon} size="sm" className="kw-iconbox--nav" />
                      <span className="kw-side__label">{label}</span>
                      {isActive ? <span className="sr-only">(actual)</span> : null}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </GlassPanel>
        </aside>

        <main id="contenido" className="kw-stage kw-main">
          <Outlet />
          <div className="fixed bottom-20 right-4 z-30 md:bottom-6">
            {guideOpen ? (
              <GlassPanel tone="tint" size="md" className="mb-2 max-w-xs">
                <p className="kw-caption">Kawiilito</p>
                <p className="kw-guide__text" style={{ marginTop: 4 }}>
                  Te explico las cifras ya preparadas por Kawiil. No hay chat con inteligencia artificial aquí.
                </p>
                <button type="button" className="kw-btn kw-btn--text" onClick={() => setGuideOpen(false)}>
                  Cerrar
                </button>
              </GlassPanel>
            ) : null}
            <KawiilitoDock label="Guía de Kawiilito" onClick={() => setGuideOpen((v) => !v)} />
          </div>
        </main>
      </div>

      <nav className="kw-bottomnav" aria-label="Secciones">
        <ul>
          {PRIMARY_NAV.slice(0, 4).map(({ to, short, label, Icon }) => (
            <li key={to}>
              <NavLink to={href(to)} end={to === "/"}>
                {({ isActive }) => (
                  <>
                    <IconBadge icon={Icon} size="sm" className="kw-iconbox--nav" />
                    <span>{short || label}</span>
                    {isActive ? <span className="sr-only">(actual)</span> : null}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" style={{ width: "100%" }}>
              <span className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold text-[color:var(--ink-muted)]">
                <IconBadge icon={MoreHorizontal} size="sm" className="kw-iconbox--nav" />
                Más
              </span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen ? (
        <div className="kw-more-panel" role="dialog" aria-modal="true" aria-label="Más secciones" onClick={() => setMoreOpen(false)}>
          <GlassPanel tone="strong" className="kw-more-sheet" onClick={(e) => e.stopPropagation()}>
            <p className="kw-title">Más</p>
            {moreItems.map(({ to, label, Icon }) => (
              <NavLink key={to} to={href(to)} className="kw-side__link" onClick={() => setMoreOpen(false)}>
                <IconBadge icon={Icon} size="sm" className="kw-iconbox--nav" />
                {label}
              </NavLink>
            ))}
            <button type="button" className="kw-btn" onClick={() => setMoreOpen(false)}>
              Cerrar
            </button>
          </GlassPanel>
        </div>
      ) : null}

      {drawerOpen ? (
        <div className="kw-more-panel kw-drawer-panel" role="dialog" aria-modal="true" aria-label="Menú" onClick={() => setDrawerOpen(false)}>
          <GlassPanel tone="strong" className="kw-drawer-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <p className="kw-title">Kawiil OS</p>
              <button type="button" className="kw-iconbtn" aria-label="Cerrar menú" onClick={() => setDrawerOpen(false)}>
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <nav className="kw-side__nav" style={{ marginTop: 12 }}>
              {navItems.map(({ to, label, Icon }) => (
                <NavLink key={to} to={href(to)} end={to === "/"} className="kw-side__link" onClick={() => setDrawerOpen(false)}>
                  <IconBadge icon={Icon} size="sm" className="kw-iconbox--nav" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </GlassPanel>
        </div>
      ) : null}

      <DemoModal open={originOpen} title="¿De dónde sale «SAT al día»?" onClose={() => setOriginOpen(false)}>
        <p className="kw-small">
          El chip indica que las cifras del resumen vienen de los CFDI de tu cuenta que el equipo de Kawiil ya tiene listos aquí.
          En esta fase solo consultas: no se descarga ni se consulta el SAT desde esta pantalla.
        </p>
        <button type="button" className="kw-btn kw-btn--primary" style={{ marginTop: 12 }} onClick={() => { setOriginOpen(false); navigate(href("/origen")); }}>
          Ir a Origen de datos
        </button>
      </DemoModal>

      <DemoToastHost />
    </div>
  );
}
