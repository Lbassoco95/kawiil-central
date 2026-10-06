import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Archive, Eye, HandHelping, Moon, Sun } from "lucide-react";
import { GlassPanel, IconBadge, KwButton } from "../design/primitives";
import { POSE_SRC } from "../design/assets";
import BrandLogo from "../design/BrandLogo";
import { useTheme } from "../design/ThemeProvider";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../lib/demo";
import { db } from "../lib/supabase";
import { usePortal } from "../lib/session";
import { isDesignPreview } from "../lib/designPreview";

const IDEAS = [
  {
    Icon: Eye,
    title: "Interpretamos",
    detail: "Tus cifras y tus mensajes del SAT en lenguaje claro.",
  },
  {
    Icon: HandHelping,
    title: "Decidimos contigo",
    detail: "Con lo que Kawiil aprende de tu negocio.",
  },
  {
    Icon: Archive,
    title: "Conservamos",
    detail: "Tu información ordenada y a la mano.",
  },
] as const;

export default function Ingresar() {
  const { session } = usePortal();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const demo = isPortalDemoMode();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;
  if (isDesignPreview()) return <Navigate to="/diseno" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(/confirm/i.test(error.message) ? "Confirme su correo con el enlace que le enviamos." : "Correo o contraseña incorrectos.");
    } else navigate("/");
  };

  return (
    <div className="kw-login">
      {demo && (
        <div className="kw-demo-banner" role="status">
          Entorno de demostración · {DEMO_FISCAL_MARK}
        </div>
      )}
      <div className="kw-stage kw-login__stage">
        <div className="kw-login__card">
          <div className="flex justify-end">
            <button type="button" className="kw-iconbtn" onClick={toggle} aria-label={theme === "light" ? "Modo oscuro" : "Modo claro"}>
              {theme === "light" ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
            </button>
          </div>

          <div className="kw-login__brand">
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
              <BrandLogo
                variant="horizontal"
                tone={theme === "dark" ? "white" : "blue"}
                height={56}
              />
            </div>
            <h1 className="sr-only">Kawiil OS</h1>
            <p className="kw-login__lead">La aplicación que tu empresa necesita para ver su negocio.</p>
            <p className="kw-login__support">
              Detrás está Kawiil: te ayudamos a interpretar tu información, decidir y conservarla, mientras tú te enfocas en tu negocio.
            </p>
          </div>

          <div className="kw-login__panels">
            <GlassPanel size="xl">
              <ul className="kw-ideas">
                {IDEAS.map(({ Icon, title, detail }) => (
                  <li key={title}>
                    <IconBadge icon={Icon} />
                    <div className="kw-ideas__copy">
                      <strong>{title}</strong>
                      <span className="kw-ideas__detail">{detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </GlassPanel>

            <div className="kw-login__compose">
              <img className="kw-login__mascot" src={POSE_SRC.saluda} alt="Kawiilito saluda" width={180} height={180} />
              <GlassPanel tone="strong" size="xl" className="kw-login__form">
                <form onSubmit={submit} className="grid" style={{ gap: 16 }} noValidate>
                  <label className="kw-label">
                    Correo
                    <input
                      className="kw-field"
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="kw-label">
                    Contraseña
                    <input
                      className="kw-field"
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  {error ? (
                    <p role="alert" className="kw-small" style={{ color: "var(--caution-text)", margin: 0 }}>
                      {error}
                    </p>
                  ) : null}
                  <KwButton variant="primary" type="submit" disabled={busy} style={{ width: "100%", minHeight: 44 }}>
                    {busy ? "Entrando…" : "Entrar"}
                  </KwButton>
                </form>
                <p style={{ margin: "14px 0 0", textAlign: "center" }}>
                  <Link className="kw-btn kw-btn--text" to="/recuperar">
                    No puedo entrar
                  </Link>
                </p>
                <p className="kw-small" style={{ margin: "10px 0 0", textAlign: "center" }}>
                  El acceso lo da Kawiil. No hay registro público.
                </p>
              </GlassPanel>
            </div>
          </div>

          <p className="kw-small" style={{ textAlign: "center" }}>
            <Link to="/legal/aviso_privacidad" style={{ color: "var(--link)" }}>
              Aviso de privacidad
            </Link>
            {" · "}
            <Link to="/diseno" style={{ color: "var(--link)" }}>
              Vista de diseño
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
