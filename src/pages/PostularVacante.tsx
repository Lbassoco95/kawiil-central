import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  CheckCircle2,
  Upload,
  MapPin,
  Clock,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";

/* ─── tipos ─────────────────────────────────────────────────── */
type Info = {
  title: string;
  area: string | null;
  grade: string | null;
  budget: number | null;
  location: string | null;
  description: string | null;
  open: boolean;
  modalidad?: string | null;
};

/* ─── sistema de crecimiento G1 → G4 ───────────────────────── */
const G_LEVELS = [
  { id: "G1", label: "Base",      sub: "Aprendizaje activo" },
  { id: "G2", label: "Autónomo",  sub: "Clientes propios" },
  { id: "G3", label: "Senior",    sub: "Lidera proyectos" },
  { id: "G4", label: "Experto",   sub: "Define metodología" },
];

const G_DESC: Record<string, string> = {
  G1: "Desarrollas base técnica, aprendes los procesos de Kawiil y comienzas a gestionar clientes bajo guía directa del equipo.",
  G2: "Gestionas clientes de forma independiente y te especializas en tu área de práctica.",
  G3: "Lideras proyectos, mentorías y tienes autonomía total sobre tus cuentas.",
  G4: "Defines metodología, formas a otros y participas en la dirección estratégica de Kawiil.",
};

const SOURCES = [
  "LinkedIn",
  "Computrabajo",
  "Indeed",
  "Referido por alguien",
  "Otro",
];

/* ─── utilidades ────────────────────────────────────────────── */
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

/** Primera oración del texto, máx 140 chars */
function heroTagline(desc: string | null): string {
  if (!desc) return "";
  const firstLine = desc.split("\n")[0].trim();
  const firstSentence = firstLine.split(/[.!?]/)[0].trim();
  const text = firstSentence || firstLine;
  return text.length > 140 ? text.substring(0, 137) + "…" : text;
}

/* ─── componente ────────────────────────────────────────────── */
export default function PostularVacante() {
  const { token = "" } = useParams();

  const [info,    setInfo]    = useState<Info | null>(null);
  const [errMsg,  setErrMsg]  = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done,    setDone]    = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [fullName, setFullName] = useState("");
  const [email,    setEmail]    = useState("");
  const [phone,    setPhone]    = useState("");
  const [source,   setSource]   = useState("");
  const [notes,    setNotes]    = useState("");
  const [cv,       setCv]       = useState<File | null>(null);
  const [company,  setCompany]  = useState(""); // honeypot anti-spam

  /* ── carga de datos ── */
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("recruit-apply", {
        body: { action: "info", token },
      });
      if (error) {
        const body = await (error as { context?: Response }).context
          ?.json?.()
          .catch(() => null);
        setErrMsg(
          body?.error ??
            "No se pudo conectar con el servidor. Intenta de nuevo más tarde.",
        );
      } else {
        const dErr = (data as { error?: string })?.error;
        if (dErr) setErrMsg(dErr);
        else setInfo(data as Info);
      }
      setLoading(false);
    })();
  }, [token]);

  const emailOk   = isValidEmail(email);
  const canSubmit = fullName.trim().length > 0 && emailOk;

  async function submit() {
    if (!fullName.trim()) return toast.error("Escribe tu nombre.");
    if (!emailOk)
      return toast.error("Escribe un correo válido para poder contactarte.");
    setSending(true);
    try {
      let cv_base64: string | undefined;
      if (cv) cv_base64 = await fileToBase64(cv);
      const { data, error } = await supabase.functions.invoke("recruit-apply", {
        body: {
          action: "apply",
          token,
          full_name: fullName,
          email,
          phone,
          source,
          notes,
          company,
          cv_base64,
          cv_name: cv?.name,
          cv_type: cv?.type,
        },
      });
      const err = error || (data as { error?: string })?.error;
      if (err) {
        toast.error(typeof err === "string" ? err : "No se pudo enviar.");
        return;
      }
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      toast.error("No se pudo enviar tu postulación.");
    } finally {
      setSending(false);
    }
  }

  /* ── estados de carga / error / éxito / cerrada ── */
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-center text-sm text-muted-foreground">
          {errMsg ?? "Esta vacante no está disponible."}
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500" />
        <h2 className="text-xl font-bold">¡Gracias por postularte!</h2>
        <p className="max-w-xs text-sm text-muted-foreground">
          Hemos recibido tu información. Te contactaremos pronto.
        </p>
        <img
          src="/images/kawiil-logo.png"
          alt="Kawiil"
          className="mt-4 h-8 w-auto opacity-40"
          onError={(e) => {
            (e.currentTarget.style.display = "none");
          }}
        />
      </div>
    );
  }

  if (!info.open) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-center text-sm text-muted-foreground">
          Esta vacante ya no recibe postulaciones.
        </p>
      </div>
    );
  }

  /* ── derivados ── */
  const gradeKey   = info.grade?.toUpperCase().match(/G[1-4]/)?.[0] ?? "";
  const gradeIndex = G_LEVELS.findIndex((g) => g.id === gradeKey);
  const hasGrade   = gradeIndex >= 0;

  const modalidadDisplay = info.modalidad
    ? info.modalidad.charAt(0).toUpperCase() + info.modalidad.slice(1)
    : "Presencial";

  const tagline = heroTagline(info.description);

  /* ── descripción extendida (si tiene saltos de línea, la mostramos) ── */
  const hasFullDesc =
    info.description &&
    (info.description.includes("\n") || info.description.length > 160);

  /* ─────────────────────────── RENDER ─────────────────────────── */
  return (
    <div className="min-h-screen bg-gray-50">

      {/* ══ NAV ══════════════════════════════════════════════════ */}
      <nav className="sticky top-0 z-10 border-b bg-white px-4 py-3">
        <img
          src="/images/kawiil-logo.png"
          alt="Kawiil"
          className="h-8 w-auto"
          onError={(e) => {
            (e.currentTarget.style.display = "none");
          }}
        />
      </nav>

      <div className="mx-auto max-w-[600px] px-4 pb-16">

        {/* ══ HERO ═════════════════════════════════════════════════ */}
        <section className="relative mt-4 overflow-hidden rounded-2xl bg-[#0f172a] px-6 py-10 text-white">
          {/* Marca de agua */}
          <div
            aria-hidden
            className="pointer-events-none absolute right-4 bottom-4 select-none text-[140px] font-extrabold leading-none text-white opacity-[0.05]"
          >
            K
          </div>

          {/* Badge área / estado */}
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {info.area ? `Área de ${info.area}` : "Kawiil"} · Vacante abierta
          </div>

          {/* Título */}
          <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-[#38bdf8]">
            {info.title}
          </h1>

          {/* Tagline */}
          {tagline && (
            <p className="mb-5 max-w-sm text-sm leading-relaxed text-white/70">
              {tagline}
            </p>
          )}

          {/* Chips de condiciones */}
          <div className="mb-6 flex flex-wrap gap-2">
            {info.location && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80">
                <MapPin className="h-3 w-3" />
                {info.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80">
              <Clock className="h-3 w-3" />
              Lun–Vie 9–18 hrs
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80">
              <Briefcase className="h-3 w-3" />
              {modalidadDisplay}
            </span>
            {info.budget != null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80">
                ${info.budget.toLocaleString("es-MX")}/mes
              </span>
            )}
          </div>

          {/* CTA → scroll al formulario */}
          <button
            onClick={() =>
              formRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-600 active:scale-95"
          >
            Postular ahora →
          </button>
        </section>

        {/* ══ SOBRE KAWIIL ═════════════════════════════════════════ */}
        <section className="mt-3 rounded-2xl bg-white p-6 shadow-sm">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-emerald-600">
            Sobre Kawiil
          </p>
          <p className="text-sm leading-relaxed text-gray-700">
            Kawiil es un despacho de servicios profesionales con base en CDMX
            que opera con{" "}
            <strong>estructura y metodología de empresa de tecnología</strong>.
            Construimos trayectorias claras para nuestro equipo con niveles
            definidos de crecimiento.
          </p>
          <div className="mt-4 grid grid-cols-3 divide-x overflow-hidden rounded-xl border text-center">
            {[
              { val: "10",   label: "Personas"  },
              { val: "CDMX", label: "Roma Sur"  },
              { val: "OS",   label: "Kawiil OS" },
            ].map(({ val, label }) => (
              <div key={label} className="py-3">
                <p className="text-base font-bold text-[#38bdf8]">{val}</p>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ══ ÁREAS DE PRÁCTICA ════════════════════════════════════ */}
        <section className="mt-3 rounded-2xl bg-white p-6 shadow-sm">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-600">
            Áreas de práctica
          </p>
          <h2 className="mb-4 text-lg font-bold text-gray-900">
            Dónde vas a trabajar
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: "📊", area: "Contable",    desc: "Contabilidad mensual, estados financieros y conciliaciones bancarias." },
              { icon: "📋", area: "Fiscal",      desc: "Declaraciones, ISR, IVA, CFDI 4.0 y atención SAT." },
              { icon: "⚖️", area: "Legal",       desc: "Contratos, asambleas, libros corporativos y marcas." },
              { icon: "👥", area: "Nómina y RH", desc: "Nóminas timbradas, IMSS, INFONAVIT y operación de personal." },
            ].map(({ icon, area, desc }) => (
              <div key={area} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="mb-1 text-xl">{icon}</p>
                <p className="text-xs font-semibold text-gray-800">{area}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ══ CÓMO TRABAJAMOS ══════════════════════════════════════ */}
        <section className="mt-3 rounded-2xl bg-white p-6 shadow-sm">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-600">
            Cómo trabajamos
          </p>
          <h2 className="mb-2 text-lg font-bold text-gray-900">
            Un hub para que te desarrolles
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-gray-600">
            No somos un despacho tradicional. Operamos con metodología ágil —
            sprints de 2 semanas, tableros visibles y entregables claros. Todo
            vive en el Hub Kawiil, nuestro sistema interno.
          </p>
          <div className="space-y-2">
            {[
              {
                label: "Sprint, no billable hour",
                desc:  "Ciclos cortos, avances medibles. Sin 'te aviso cuando esté listo'.",
              },
              {
                label: "Hub Kawiil",
                desc:  "Legal, contable, fiscal y nómina en un solo sistema. Cero Excels sueltos.",
              },
              {
                label: "Cartera propia desde G2",
                desc:  "A partir del nivel Autónomo, gestionas clientes directamente.",
              },
            ].map(({ label, desc }) => (
              <div key={label} className="flex gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <p className="text-xs font-semibold text-gray-800">{label}</p>
                  <p className="text-[11px] leading-relaxed text-gray-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ SISTEMA DE CRECIMIENTO (sólo si hay grade) ══════════ */}
        {hasGrade && (
          <section className="mt-3 rounded-2xl bg-white p-6 shadow-sm">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-600">
              Sistema de crecimiento
            </p>
            <h2 className="mb-5 text-lg font-bold text-gray-900">
              Tu trayectoria {gradeKey} → G4
            </h2>

            {/* Línea de tiempo */}
            <div className="relative mb-5">
              <div className="absolute top-5 left-[12.5%] right-[12.5%] h-0.5 bg-gray-200" />
              <div className="flex justify-between">
                {G_LEVELS.map((g, i) => {
                  const isActive = i === gradeIndex;
                  const isPast   = i < gradeIndex;
                  return (
                    <div
                      key={g.id}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <div
                        className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold ${
                          isActive
                            ? "bg-emerald-500 text-white ring-4 ring-emerald-100"
                            : isPast
                            ? "bg-[#0f172a] text-white"
                            : "bg-[#1e293b] text-gray-400"
                        }`}
                      >
                        {g.id}
                      </div>
                      <p
                        className={`text-[11px] font-medium ${
                          isActive ? "text-emerald-600" : "text-gray-500"
                        }`}
                      >
                        {g.label}
                      </p>
                      <p className="text-[10px] text-gray-400">{g.sub}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Card del nivel actual */}
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Estás aquí: {gradeKey}
              </p>
              <p className="text-sm leading-relaxed text-emerald-900">
                {G_DESC[gradeKey] ?? ""}
              </p>
            </div>
          </section>
        )}

        {/* ══ DESCRIPCIÓN COMPLETA (si el texto es largo) ════════ */}
        {hasFullDesc && (
          <section className="mt-3 rounded-2xl bg-white p-6 shadow-sm">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-emerald-600">
              Descripción del puesto
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">
              {info.description}
            </p>
          </section>
        )}

        {/* ══ FORMULARIO ═══════════════════════════════════════════ */}
        <section
          ref={formRef}
          className="mt-3 rounded-2xl bg-white p-6 shadow-sm"
        >
          <p className="mb-5 text-base font-bold text-gray-900">
            Postúlate a esta vacante
          </p>

          <div className="space-y-4">
            {/* Nombre */}
            <div className="space-y-1.5">
              <Label>
                Nombre completo{" "}
                <span className="text-red-500">*</span>
              </Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="María Pérez García"
              />
            </div>

            {/* Correo + teléfono */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>
                  Correo <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tucorreo@ejemplo.com"
                  aria-invalid={email.length > 0 && !emailOk}
                />
                {email.length > 0 && !emailOk && (
                  <p className="text-xs text-red-500">
                    Escribe un correo válido.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Teléfono</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="55 1234 5678"
                />
              </div>
            </div>

            {/* Fuente */}
            <div className="space-y-1.5">
              <Label>¿Dónde viste la vacante?</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona una opción" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Mensaje */}
            <div className="space-y-1.5">
              <Label>Mensaje (opcional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Cuéntanos brevemente por qué te interesa la vacante."
              />
            </div>

            {/* CV */}
            <div className="space-y-1.5">
              <Label>CV (recomendado)</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" /> Adjuntar
                </Button>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {cv ? cv.name : "PDF o Word"}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf"
                  className="hidden"
                  onChange={(e) => setCv(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>

            {/* Honeypot oculto anti-spam */}
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="hidden"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
            />

            <Button
              className="w-full bg-emerald-500 text-white hover:bg-emerald-600"
              size="lg"
              onClick={submit}
              disabled={sending || !canSubmit}
            >
              {sending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Enviar postulación
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
