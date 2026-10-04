import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, Moon, MoreHorizontal, Sun } from "lucide-react";
import { usePortal } from "../lib/session";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../lib/demo";
import { db } from "../lib/supabase";
import { ALL_NAV, MORE_NAV, PRIMARY_NAV } from "../lib/nav";
import { LOGO } from "../design/assets";
import { GlassPanel, IconBadge, KawiilitoDock, SourceChip } from "../design/primitives";
import { useTheme } from "../design/ThemeProvider";
import { isDesignPreview } from "../lib/designPreview";
import { portalPath } from "../lib/basePath";

export default function Layout() {
  const { me, active, setActive } = usePortal();
  const navigate = useNavigate();
  const demo = isPortalDemoMode() || isDesignPreview();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const href = (to: string) => portalPath(to);

  return (
    <div className="kw-shell">
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
            <div className="kw-header__brand">
              <img className="logo-light" src={LOGO.wordBlue} alt="Kawiil Mx" />
              <img className="logo-dark" src={LOGO.wordWhite} alt="Kawiil Mx" />
              {demo && <span className="kw-caption">DEMO</span>}
            </div>

            <nav className="kw-topnav" aria-label="Secciones">
              {ALL_NAV.filter((n) => n.to !== "/facturas" && n.to !== "/cuenta").map(({ to, label, Icon }) => (
                <NavLink key={to} to={href(to)} end={to === "/"}>
                  {({ isActive }) => (
                    <>
                      <IconBadge icon={Icon} size="sm" className="kw-iconbox--nav" />
                      {label}
                      {isActive ? <span className="sr-only">(actual)</span> : null}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <SourceChip source="sat" label="SAT al día" via="ejemplo" />
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
        <aside className="kw-side" aria-label="Navegación">
          <GlassPanel>
            <p className="kw-caption">Kawiil OS</p>
            <nav className="kw-side__nav">
              {ALL_NAV.filter((n) => n.to !== "/facturas").map(({ to, label, Icon }) => (
                <NavLink key={to} to={href(to)} end={to === "/"} className="kw-side__link">
                  {({ isActive }) => (
                    <>
                      <IconBadge icon={Icon} size="sm" className="kw-iconbox--nav" />
                      {label}
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
          <GlassPanel
            tone="strong"
            className="kw-more-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="kw-title">Más</p>
            {[...PRIMARY_NAV.slice(4), ...MORE_NAV].map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={href(to)}
                className="kw-side__link"
                onClick={() => setMoreOpen(false)}
              >
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
    </div>
  );
}
