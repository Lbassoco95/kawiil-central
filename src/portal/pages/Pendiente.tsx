import { Navigate } from "react-router-dom";
import AuthShell from "../components/AuthShell";
import { Notice } from "../components/ui";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";

/**
 * Fase 1: sin alta automática. La empresa la publica/vincula Kawiil desde central.
 * Fase 2 (futura) permitirá que el usuario dé de alta datos solo.
 */
export default function Pendiente() {
  const { me } = usePortal();
  if (me?.status === "activa" && (me.clients?.length ?? 0) > 0) return <Navigate to="/" replace />;

  return (
    <AuthShell title="Su cuenta está pendiente">
      <Notice tone="wait" title="Pendiente de vinculación">
        Si ya es cliente de Kawiil, su equipo vinculará esta cuenta ({me?.email}) con su empresa desde central
        y publicará la representación al portal. Mientras tanto no verá datos del servicio.
      </Notice>
      <Notice tone="info" title="Sin alta automática en esta fase">
        En la fase actual Kawiil OS solo muestra lo que central ya publicó. No hay registro de empresa ni carga
        de facturas por el cliente. Esa alta automática queda para una fase posterior.
      </Notice>
      <button className="mt-4 w-full text-sm underline" onClick={() => db.auth.signOut()}>Cerrar sesión</button>
    </AuthShell>
  );
}
