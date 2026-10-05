import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "../components/AuthShell";
import { Notice } from "../components/ui";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { callApi } from "../lib/api";

export default function Pendiente() {
  const { me, refresh } = usePortal();
  const [basic, setBasic] = useState({ razon: "", rfc: "" });
  const [err, setErr] = useState<string | null>(null);
  if (me?.status === "activa" && (me.clients?.length ?? 0) > 0) return <Navigate to="/" replace />;

  const activate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await callApi("cuenta.activar_basico", { razon_social: basic.razon, rfc: basic.rfc });
      await refresh();
    } catch (error) { setErr((error as Error).message); }
  };

  return (
    <AuthShell title="Su cuenta está pendiente">
      <Notice tone="wait" title="Pendiente de vinculación">
        Si ya es cliente de Kawiil, su equipo vinculará esta cuenta ({me?.email}) con su empresa. Mientras tanto no verá ningún dato.
      </Notice>
      <h2 className="mt-6 text-lg">¿Aún no es cliente? Use el nivel básico</h2>
      <p className="text-sm text-muted-foreground">Podrá cargar sus facturas, ver su tablero de gasto y, cuando acepte el contrato de uso, emitir un número limitado de facturas.</p>
      <form onSubmit={activate} className="mt-3 space-y-3">
        <div><Label htmlFor="razon">Nombre o razón social</Label><Input id="razon" required value={basic.razon} onChange={(e) => setBasic({ ...basic, razon: e.target.value })} /></div>
        <div><Label htmlFor="rfc">RFC</Label><Input id="rfc" required className="kw-mono uppercase" maxLength={13} value={basic.rfc} onChange={(e) => setBasic({ ...basic, rfc: e.target.value.toUpperCase() })} /></div>
        {err && <Notice tone="bad">{err}</Notice>}
        <Button type="submit" className="w-full">Usar el nivel básico</Button>
      </form>
      <button className="mt-4 w-full text-sm underline" onClick={() => db.auth.signOut()}>Cerrar sesión</button>
    </AuthShell>
  );
}
