import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "../components/AuthShell";
import { Notice } from "../components/ui";
import { db } from "../lib/supabase";
import { usePortal } from "../lib/session";

export default function Ingresar() {
  const { session } = usePortal();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(/confirm/i.test(error.message) ? "Confirme su correo con el enlace que le enviamos." : "Correo o contraseña incorrectos.");
    else navigate("/");
  };

  return (
    <AuthShell title="Portal del cliente">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</Button>
      </form>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <Link className="text-primary underline" to="/recuperar">¿Olvidó su contraseña?</Link>
        <Link className="text-primary underline" to="/registro">Crear una cuenta</Link>
        <Link className="text-muted-foreground underline" to="/legal/aviso_privacidad">Aviso de privacidad</Link>
      </div>
    </AuthShell>
  );
}
