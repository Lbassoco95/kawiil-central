import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "../components/AuthShell";
import { Notice } from "../components/ui";
import { db } from "../lib/supabase";

export default function Recuperar() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const base = import.meta.env.VITE_PORTAL_PUBLIC_URL || window.location.origin;
    await db.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${base}/restablecer` });
    setSent(true);
  };
  return (
    <AuthShell title="Recuperar contraseña">
      {sent ? (
        <Notice tone="ok">Si el correo tiene cuenta, le enviamos un enlace para crear una contraseña nueva.</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" className="w-full">Enviar enlace</Button>
        </form>
      )}
      <p className="mt-4 text-sm"><Link className="text-primary underline" to="/ingresar">Volver a ingresar</Link></p>
    </AuthShell>
  );
}
