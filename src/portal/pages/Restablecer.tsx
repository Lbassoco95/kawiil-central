import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "../components/AuthShell";
import { Notice } from "../components/ui";
import { db } from "../lib/supabase";

export default function Restablecer() {
  const navigate = useNavigate();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p1.length < 10) return setErr("Use al menos 10 caracteres.");
    if (p1 !== p2) return setErr("Las contraseñas no coinciden.");
    const { error } = await db.auth.updateUser({ password: p1 });
    if (error) return setErr("El enlace ya no es válido. Pida uno nuevo.");
    navigate("/");
  };
  return (
    <AuthShell title="Nueva contraseña">
      <form onSubmit={submit} className="space-y-4">
        <div><Label htmlFor="p1">Contraseña nueva</Label><Input id="p1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></div>
        <div><Label htmlFor="p2">Repita la contraseña</Label><Input id="p2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
        {err && <Notice tone="bad">{err}</Notice>}
        <Button type="submit" className="w-full">Guardar</Button>
      </form>
    </AuthShell>
  );
}
