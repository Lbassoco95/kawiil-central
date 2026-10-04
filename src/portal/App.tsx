import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { SessionProvider, usePortal } from "./lib/session";
import { ThemeProvider } from "./design/ThemeProvider";
import { isDesignPreview } from "./lib/designPreview";
import Layout from "./components/Layout";
import Ingresar from "./pages/Ingresar";
import Recuperar from "./pages/Recuperar";
import Reenviar from "./pages/Reenviar";
import Restablecer from "./pages/Restablecer";
import Legal from "./pages/Legal";
import Pendiente from "./pages/Pendiente";
import AceptarTextos from "./pages/AceptarTextos";
import Resumen from "./pages/Resumen";
import Ingresos from "./pages/Ingresos";
import Egresos from "./pages/Egresos";
import Buzon from "./pages/Buzon";
import Facturas from "./pages/Facturas";
import FacturaDetalle from "./pages/FacturaDetalle";
import Documentos from "./pages/Documentos";
import Alertas from "./pages/Alertas";
import Mensajes from "./pages/Mensajes";
import Facturacion from "./pages/Facturacion";
import Origen from "./pages/Origen";
import Hallazgos from "./pages/Hallazgos";
import Cuenta from "./pages/Cuenta";
import { db } from "./lib/supabase";

function Loading() {
  return (
    <div className="kw-stage grid min-h-screen place-items-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--link)" }} aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

function DesignGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (isDesignPreview() || location.pathname.startsWith("/diseno")) return <>{children}</>;
  return null;
}

function Gate({ children }: { children: ReactNode }) {
  const { session, loading, me } = usePortal();
  const location = useLocation();
  if (isDesignPreview() || location.pathname.startsWith("/diseno")) return <>{children}</>;
  if (loading || (session && !me)) return <Loading />;
  if (!session) return <Navigate to="/ingresar" replace />;
  if (!me?.is_portal_account) {
    return (
      <div className="kw-stage mx-auto max-w-md p-6">
        <h1 className="kw-page-title" style={{ fontSize: 28 }}>Esta cuenta es del equipo de Kawiil</h1>
        <p className="kw-small mt-2">Las cuentas del equipo trabajan en Kawiil central, no en el portal del cliente.</p>
        <button className="kw-btn kw-btn--text mt-4" onClick={() => db.auth.signOut()}>Cerrar sesión</button>
      </div>
    );
  }
  if (me.status === "suspendida") {
    return (
      <div className="kw-stage mx-auto max-w-md p-6">
        <h1 className="kw-page-title" style={{ fontSize: 28 }}>Cuenta suspendida</h1>
        <p className="kw-small mt-2">Su acceso está suspendido. Si cree que es un error, comuníquese con su contacto en Kawiil.</p>
        <button className="kw-btn kw-btn--text mt-4" onClick={() => db.auth.signOut()}>Cerrar sesión</button>
      </div>
    );
  }
  if ((me.pending_legal?.length ?? 0) > 0) return <AceptarTextos />;
  return <>{children}</>;
}

function ActiveOnly({ children }: { children: ReactNode }) {
  const { me } = usePortal();
  const location = useLocation();
  if (isDesignPreview() || location.pathname.startsWith("/diseno")) return <>{children}</>;
  if (me?.status !== "activa" || (me.clients?.length ?? 0) === 0) return <Navigate to="/pendiente" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/ingresar" element={<Ingresar />} />
      <Route path="/registro" element={<Navigate to="/ingresar" replace />} />
      <Route path="/recuperar" element={<Recuperar />} />
      <Route path="/reenviar" element={<Reenviar />} />
      <Route path="/restablecer" element={<Restablecer />} />
      <Route path="/legal/:kind" element={<Legal />} />
      <Route path="/pendiente" element={<Gate><Pendiente /></Gate>} />

      {/* Vista de diseño sin sesión */}
      <Route path="/diseno" element={<DesignGate><Layout /></DesignGate>}>
        <Route index element={<Resumen />} />
        <Route path="ingresos" element={<Ingresos />} />
        <Route path="egresos" element={<Egresos />} />
        <Route path="buzon" element={<Buzon />} />
        <Route path="mensajes" element={<Mensajes />} />
        <Route path="facturacion" element={<Facturacion />} />
        <Route path="origen" element={<Origen />} />
        <Route path="hallazgos" element={<Hallazgos />} />
      </Route>

      <Route element={<Gate><ActiveOnly><Layout /></ActiveOnly></Gate>}>
        <Route index element={<Resumen />} />
        <Route path="ingresos" element={<Ingresos />} />
        <Route path="egresos" element={<Egresos />} />
        <Route path="buzon" element={<Buzon />} />
        <Route path="mensajes" element={<Mensajes />} />
        <Route path="facturacion" element={<Facturacion />} />
        <Route path="origen" element={<Origen />} />
        <Route path="hallazgos" element={<Hallazgos />} />
        <Route path="facturas" element={<Facturas />} />
        <Route path="facturas/nueva" element={<Navigate to="/facturacion" replace />} />
        <Route path="facturas/:id" element={<FacturaDetalle />} />
        <Route path="documentos" element={<Documentos />} />
        <Route path="alertas" element={<Alertas />} />
        <Route path="tickets" element={<Navigate to="/" replace />} />
        <Route path="cuenta" element={<Cuenta />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SessionProvider>
          <AppRoutes />
        </SessionProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
