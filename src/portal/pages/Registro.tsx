import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import AuthShell from "../components/AuthShell";
import { Notice } from "../components/ui";
import { callApi, PortalApiError } from "../lib/api";

export default function Registro() {
  const [f, setF] = useState({ full_name: "", email: "", password: "" });
  const [aviso, setAviso] = useState(false);
  const [terminos, setTerminos] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password.length < 10) return setMsg({ tone: "bad", text: "La contraseña debe tener al menos 10 caracteres." });
    if (!aviso || !terminos) return setMsg({ tone: "bad", text: "Para crear su cuenta debe aceptar el aviso de privacidad y los términos." });
    setBusy(true);
    try {
      const r = await callApi<{ message: string }>("cuenta.registrar", { ...f, acepta_aviso: aviso, acepta_terminos: terminos });
      setMsg({ tone: "ok", text: `${r.message} Después de confirmarlo, su cuenta quedará pendiente hasta que Kawiil la vincule con su empresa, o podrá usar el nivel básico.` });
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof PortalApiError ? err.message : "No se pudo crear la cuenta." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Crear cuenta">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="nombre">Nombre completo</Label>
          <Input id="nombre" autoComplete="name" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="correo">Correo electrónico</Label>
          <Input id="correo" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="pass">Contraseña (mínimo 10 caracteres)</Label>
          <Input id="pass" type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="aviso" checked={aviso} onCheckedChange={(v) => setAviso(v === true)} />
          <Label htmlFor="aviso" className="text-sm font-normal leading-snug">
            He leído y acepto el <Link to="/legal/aviso_privacidad" className="text-primary underline" target="_blank">aviso de privacidad</Link>.
          </Label>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="terminos" checked={terminos} onCheckedChange={(v) => setTerminos(v === true)} />
          <Label htmlFor="terminos" className="text-sm font-normal leading-snug">
            Acepto los <Link to="/legal/terminos" className="text-primary underline" target="_blank">términos y condiciones</Link>.
          </Label>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creando…" : "Crear cuenta"}</Button>
      </form>
      <p className="mt-4 text-sm"><Link className="text-primary underline" to="/ingresar">Ya tengo cuenta</Link></p>
    </AuthShell>
  );
}
