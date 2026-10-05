import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "./ui";
import Turnstile, { turnstileSiteKey, type TurnstileHandle } from "./Turnstile";
import { callApi, PortalApiError } from "../lib/api";

/** Formulario público de un solo correo (recuperar / reenviar), con captcha y respuesta genérica. */
export default function PublicEmailForm({ operation, submitLabel }: { operation: "cuenta.recuperar" | "cuenta.reenviar_confirmacion"; submitLabel: string }) {
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const widget = useRef<TurnstileHandle>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await callApi<{ message: string }>(operation, { email: email.trim(), captcha_token: captcha });
      setMsg({ tone: "ok", text: r.message });
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof PortalApiError ? err.message : "No se pudo completar. Intente de nuevo." });
    } finally {
      setBusy(false);
      widget.current?.reset();
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="email">Correo electrónico</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Turnstile ref={widget} onToken={setCaptcha} />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Button type="submit" className="w-full" disabled={busy || !captcha || !turnstileSiteKey()}>{busy ? "Enviando…" : submitLabel}</Button>
    </form>
  );
}
