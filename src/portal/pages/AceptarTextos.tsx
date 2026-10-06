import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import AuthShell from "../components/AuthShell";
import LegalText, { useLegal } from "../components/LegalText";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { callApi } from "../lib/api";
import { Notice } from "../components/ui";

/** Se muestra cuando hay una versión nueva del aviso o de los términos por aceptar. */
export default function AceptarTextos() {
  const { me, refresh } = usePortal();
  const pending = me?.pending_legal ?? [];
  const current = pending[0];
  const doc = useLegal(current?.kind ?? "aviso_privacidad");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = async () => {
    try {
      await callApi("legal.aceptar", { kind: current.kind, client_id: null, user_agent: navigator.userAgent });
      setOk(false);
      await refresh();
    } catch { setErr("No se pudo registrar su aceptación."); }
  };
  return (
    <AuthShell title="Antes de continuar">
      <p className="mb-3 text-sm">Hay una versión vigente que necesita aceptar.</p>
      <LegalText doc={doc} />
      <div className="mt-4 flex items-start gap-2">
        <Checkbox id="acepto" checked={ok} onCheckedChange={(v) => setOk(v === true)} />
        <Label htmlFor="acepto" className="text-sm font-normal">He leído y acepto «{current?.title}» (versión {current?.version}).</Label>
      </div>
      {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
      <Button className="mt-4 w-full" disabled={!ok} onClick={accept}>Aceptar y continuar</Button>
      <button className="mt-3 w-full text-sm underline" onClick={() => db.auth.signOut()}>Cerrar sesión</button>
    </AuthShell>
  );
}
