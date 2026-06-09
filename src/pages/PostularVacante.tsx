import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, Upload, MapPin, Wallet, Briefcase } from "lucide-react";
import { toast } from "sonner";

type Info = {
  title: string;
  area: string | null;
  grade: string | null;
  budget: number | null;
  location: string | null;
  description: string | null;
  open: boolean;
};

const SOURCES = ["LinkedIn", "Computrabajo", "Indeed", "Referido por alguien", "Otro"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default function PostularVacante() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [cv, setCv] = useState<File | null>(null);
  const [company, setCompany] = useState(""); // honeypot

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("recruit-apply", { body: { action: "info", token } });
      if (error) {
        // supabase-js marca como error cualquier 4xx/5xx; leemos el motivo real del cuerpo.
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        setErrMsg(body?.error ?? "No se pudo conectar con el servidor. Intenta de nuevo más tarde.");
      } else {
        const dErr = (data as { error?: string })?.error;
        if (dErr) setErrMsg(dErr);
        else setInfo(data as Info);
      }
      setLoading(false);
    })();
  }, [token]);

  const emailOk = isValidEmail(email);
  const canSubmit = fullName.trim().length > 0 && emailOk;

  async function submit() {
    if (!fullName.trim()) return toast.error("Escribe tu nombre.");
    if (!emailOk) return toast.error("Escribe un correo válido para poder contactarte.");
    setSending(true);
    try {
      let cv_base64: string | undefined;
      if (cv) cv_base64 = await fileToBase64(cv);
      const { data, error } = await supabase.functions.invoke("recruit-apply", {
        body: {
          action: "apply", token,
          full_name: fullName, email, phone, source, notes, company,
          cv_base64, cv_name: cv?.name, cv_type: cv?.type,
        },
      });
      const err = error || (data as { error?: string })?.error;
      if (err) { toast.error(typeof err === "string" ? err : "No se pudo enviar."); return; }
      setDone(true);
    } catch {
      toast.error("No se pudo enviar tu postulación.");
    } finally {
      setSending(false);
    }
  }

  const meta = info
    ? [
        info.area,
        info.grade,
        info.location,
        info.budget != null ? `$${info.budget.toLocaleString("es-MX")}/mes` : null,
      ].filter(Boolean) as string[]
    : [];

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        {loading ? (
          <CardContent className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        ) : !info ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {errMsg ?? "Esta vacante no está disponible."}
          </CardContent>
        ) : done ? (
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-base font-medium">¡Gracias por postularte!</p>
            <p className="text-sm text-muted-foreground">Hemos recibido tu información. Te contactaremos pronto.</p>
          </CardContent>
        ) : !info.open ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Esta vacante ya no recibe postulaciones.
          </CardContent>
        ) : (
          <CardContent className="space-y-5 p-5 sm:p-6">
            {/* ---------- Contexto de la vacante ---------- */}
            <div className="space-y-3 border-b pb-4">
              <img
                src="/images/kawiil-logo.png"
                alt="Kawiil"
                className="h-9 w-auto"
                onError={(e) => { (e.currentTarget.style.display = "none"); }}
              />
              <div>
                <h1 className="text-xl font-bold tracking-tight">{info.title}</h1>
                {meta.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {info.area && <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{info.area}</span>}
                    {info.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{info.location}</span>}
                    {info.budget != null && <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5" />${info.budget.toLocaleString("es-MX")}/mes</span>}
                    {info.grade && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{info.grade}</span>}
                  </div>
                )}
              </div>
              {info.description && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">{info.description}</p>
              )}
            </div>

            {/* ---------- Formulario ---------- */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Postúlate a esta vacante</p>

              <div className="space-y-1.5">
                <Label>Nombre completo <span className="text-red-500">*</span></Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="María Pérez García" />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Correo <span className="text-red-500">*</span></Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tucorreo@ejemplo.com"
                    aria-invalid={email.length > 0 && !emailOk}
                  />
                  {email.length > 0 && !emailOk && (
                    <p className="text-xs text-red-500">Escribe un correo válido.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55 1234 5678" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>¿Dónde viste la vacante?</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger><SelectValue placeholder="Selecciona una opción" /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Mensaje (opcional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Cuéntanos brevemente por qué te interesa la vacante." />
              </div>

              <div className="space-y-1.5">
                <Label>CV (recomendado)</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" /> Adjuntar
                  </Button>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{cv ? cv.name : "PDF o Word"}</span>
                  <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf" className="hidden"
                    onChange={(e) => setCv(e.target.files?.[0] ?? null)} />
                </div>
              </div>

              {/* Honeypot oculto anti-spam */}
              <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />

              <Button className="w-full" size="lg" onClick={submit} disabled={sending || !canSubmit}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar postulación
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
