import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, HandHelping, Archive } from "lucide-react";
import { GlassPanel, KwButton } from "../design/primitives";
import { LOGO, POSE_SRC } from "../design/assets";
import { useTheme } from "../design/ThemeProvider";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../lib/demo";
import { db } from "../lib/supabase";
import { usePortal } from "../lib/session";
import { isDesignPreview } from "../lib/designPreview";
import { Moon, Sun } from "lucide-react";

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
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>

          <div className="kw-login__brand">
            <img
              src={theme === "dark" ? LOGO.wordWhite : LOGO.wordBlue}
              alt="Kawiil Mx"
              style={{ height: 36, margin: "0 auto" }}
            />
            <img className="kw-login__mascot" src={POSE_SRC.saluda} alt="Kawiilito saluda" />
            <h1>Kawiil OS</h1>
            <p className="kw-login__lead">La aplicación que tu empresa necesita para ver su negocio.</p>
            <p className="kw-login__support">
              Detrás está Kawiil: te ayudamos a interpretar tu información, decidir y conservarla, mientras tú te enfocas en tu negocio.
            </p>
          </div>

          <GlassPanel size="xl">
            <ul className="kw-ideas">
              <li>
                <span className="kw-ideas__icon" aria-hidden>
                  <Eye className="h-5 w-5" />
                </span>
                <div>
                  <strong>Interpretamos</strong>
                  <span>Tus cifras y tus mensajes del SAT en lenguaje claro.</span>
                </div>
              </li>
              <li>
                <span className="kw-ideas__icon" aria-hidden>
                  <HandHelping className="h-5 w-5" />
                </span>
                <div>
                  <strong>Decidimos contigo</strong>
                  <span>Con lo que Kawiil aprende de tu negocio.</span>
                </div>
              </li>
              <li>
                <span className="kw-ideas__icon" aria-hidden>
                  <Archive className="h-5 w-5" />
                </span>
                <div>
                  <strong>Conservamos</strong>
                  <span>Tu información ordenada y a la mano.</span>
                </div>
              </li>
            </ul>
          </GlassPanel>

          <GlassPanel tone="strong" size="xl">
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
