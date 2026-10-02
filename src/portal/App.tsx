import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { SessionProvider, usePortal } from "./lib/session";
import Layout from "./components/Layout";
import Ingresar from "./pages/Ingresar";
import Registro from "./pages/Registro";
import Recuperar from "./pages/Recuperar";
import Reenviar from "./pages/Reenviar";
import Restablecer from "./pages/Restablecer";
import Legal from "./pages/Legal";
import Pendiente from "./pages/Pendiente";
import AceptarTextos from "./pages/AceptarTextos";
import Inicio from "./pages/Inicio";
import Facturas from "./pages/Facturas";
import FacturaDetalle from "./pages/FacturaDetalle";
import Documentos from "./pages/Documentos";
import Alertas from "./pages/Alertas";
import Mensajes from "./pages/Mensajes";
import Cuenta from "./pages/Cuenta";
import { db } from "./lib/supabase";

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { session, loading, me } = usePortal();
  if (loading || (session && !me)) return <Loading />;
  if (!session) return <Navigate to="/ingresar" replace />;
  if (!me?.is_portal_account) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold gradient-text">Esta cuenta es del equipo de Kawiil</h1>
        <p className="mt-2 text-sm">Las cuentas del equipo trabajan en Kawiil OS (central), no en el portal del cliente.</p>
        <button className="mt-4 underline" onClick={() => db.auth.signOut()}>Cerrar sesión</button>
      </div>
    );
  }
  if (me.status === "suspendida") {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold gradient-text">Cuenta suspendida</h1>
        <p className="mt-2 text-sm">Su acceso está suspendido. Si cree que es un error, comuníquese con su contacto en Kawiil.</p>
        <button className="mt-4 underline" onClick={() => db.auth.signOut()}>Cerrar sesión</button>
      </div>
    );
  }
  if ((me.pending_legal?.length ?? 0) > 0) return <AceptarTextos />;
  return <>{children}</>;
}

function ActiveOnly({ children }: { children: ReactNode }) {
  const { me } = usePortal();
  if (me?.status !== "activa" || (me.clients?.length ?? 0) === 0) return <Navigate to="/pendiente" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/ingresar" element={<Ingresar />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/recuperar" element={<Recuperar />} />
          <Route path="/reenviar" element={<Reenviar />} />
          <Route path="/restablecer" element={<Restablecer />} />
          <Route path="/legal/:kind" element={<Legal />} />
          <Route path="/pendiente" element={<Gate><Pendiente /></Gate>} />
          <Route element={<Gate><ActiveOnly><Layout /></ActiveOnly></Gate>}>
            <Route index element={<Inicio />} />
            <Route path="facturas" element={<Facturas />} />
            <Route path="facturas/nueva" element={<Navigate to="/facturas" replace />} />
            <Route path="facturas/:id" element={<FacturaDetalle />} />
            <Route path="documentos" element={<Documentos />} />
            <Route path="alertas" element={<Alertas />} />
            <Route path="tickets" element={<Navigate to="/" replace />} />
            <Route path="mensajes" element={<Mensajes />} />
            <Route path="cuenta" element={<Cuenta />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
