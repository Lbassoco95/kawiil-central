import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, Upload, Briefcase } from "lucide-react";
import { toast } from "sonner";

type Info = { title: string; area: string | null; open: boolean };

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export default function PostularVacante() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
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
      if (error || (data as { error?: string })?.error) setInfo(null);
      else setInfo(data as Info);
      setLoading(false);
    })();
  }, [token]);

  async function submit() {
    if (!fullName.trim()) return toast.error("Escribe tu nombre.");
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        {loading ? (
          <CardContent className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        ) : !info ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Esta vacante no está disponible.
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
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Briefcase className="h-5 w-5 text-primary" />
                Postúlate: {info.title}
              </CardTitle>
              {info.area && <p className="text-sm text-muted-foreground">{info.area}</p>}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nombre completo *</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Correo</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>¿Dónde viste la vacante?</Label>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Computrabajo, LinkedIn, referido…" />
              </div>
              <div className="space-y-1.5">
                <Label>Mensaje (opcional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label>CV (opcional)</Label>
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
              <Button className="w-full" onClick={submit} disabled={sending || !fullName.trim()}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar postulación
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
