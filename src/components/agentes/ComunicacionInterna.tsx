import { useState } from "react";
import { Loader2, Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAvisosAdmin, useCancelarAviso, usePublicarAviso, useRedactarAviso, type AvisoAdmin } from "@/hooks/useAvisosEquipo";
import { hoyEnMexico, validarAviso, vigente, type AvisoEntrada, type TipoAviso } from "../../../supabase/functions/_shared/avisos";

// Comunicación interna (solo Dirección): el agente «Comunicación interna» redacta el aviso para el equipo a partir de lo que pides, TÚ lo revisas y lo
// apruebas, y entonces una función del sistema lo publica: se ve en pantalla a todo el equipo al entrar al sistema durante esos días. El agente solo
// propone; nada se publica sin tu clic. No hay correo, Slack ni WhatsApp: solo avisos en pantalla.
const VACIO: AvisoEntrada = { tipo: "dia_inhabil", titulo: "", mensaje: "", desde: "", hasta: "" };
const dia = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const periodo = (a: { desde: string; hasta: string }) => (a.desde === a.hasta ? dia(a.desde) : `del ${dia(a.desde)} al ${dia(a.hasta)}`);

function estadoDe(a: AvisoAdmin, hoy: string): string {
  if (a.estado === "cancelado") return "Cancelado";
  if (vigente(a, hoy)) return "Se ve hoy";
  return a.hasta < hoy ? "Terminó" : "Programado";
}

export function ComunicacionInterna() {
  const lista = useAvisosAdmin();
  const redactar = useRedactarAviso();
  const publicar = usePublicarAviso();
  const cancelar = useCancelarAviso();
  const [instruccion, setInstruccion] = useState("");
  const [aviso, setAviso] = useState<AvisoEntrada>(VACIO);
  const [origen, setOrigen] = useState<"agente" | "direccion">("direccion");
  const [publicado, setPublicado] = useState<string | null>(null);
  const hoy = hoyEnMexico();
  const v = validarAviso(aviso, hoy);
  const errores = "errores" in v ? v.errores : [];
  const set = <K extends keyof AvisoEntrada>(k: K, val: AvisoEntrada[K]) => { setAviso((a) => ({ ...a, [k]: val })); setPublicado(null); };

  const pedirBorrador = () => {
    setPublicado(null);
    redactar.mutate(instruccion, { onSuccess: (b) => { setAviso(b); setOrigen("agente"); } });
  };
  const aprobar = () => {
    if (!v.ok) return;
    publicar.mutate({ aviso: v.aviso, redactadoPor: origen }, { onSuccess: (a) => { setPublicado(periodo(a)); setAviso(VACIO); setInstruccion(""); setOrigen("direccion"); } });
  };

  return (
    <div className="space-y-4" data-testid="comunicacion">
      <section className="zen-glass space-y-3 rounded-3xl p-4" aria-label="Redactar un aviso">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Megaphone className="h-4 w-4 shrink-0" aria-hidden />El agente «Comunicación interna» redacta el aviso; tú lo revisas y lo apruebas. Se ve en pantalla a todo el equipo al entrar al sistema. No sale por correo, Slack ni WhatsApp.</p>
        <label className="block space-y-1 text-sm">¿Qué quieres avisar al equipo?
          <Textarea value={instruccion} onChange={(e) => setInstruccion(e.target.value)} rows={2} maxLength={800} data-testid="comunicacion-instruccion"
            placeholder="Ej.: El lunes 16 no se trabajará; retomamos el martes 17." />
        </label>
        <Button type="button" variant="outline" onClick={pedirBorrador} disabled={instruccion.trim().length < 8 || redactar.isPending} data-testid="comunicacion-redactar">
          {redactar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Redactar con el agente
        </Button>
        {redactar.isError && <p role="alert" className="text-sm text-destructive" data-testid="comunicacion-error-redactar">{(redactar.error as Error).message}</p>}
      </section>

      <section className="zen-glass space-y-3 rounded-3xl p-4" aria-label="Revisar y publicar" data-testid="comunicacion-borrador">
        <h2 className="text-base font-medium">Aviso para el equipo</h2>
        {origen === "agente" && <p className="text-xs text-muted-foreground" data-testid="comunicacion-origen">Borrador del agente. Revísalo y corrígelo si hace falta.</p>}
        <label className="block space-y-1 text-sm">Tipo
          <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={aviso.tipo} onChange={(e) => set("tipo", e.target.value as TipoAviso)} data-testid="comunicacion-tipo">
            <option value="dia_inhabil">Día sin trabajo</option><option value="general">Aviso general</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">Título
          <Input value={aviso.titulo} maxLength={120} onChange={(e) => set("titulo", e.target.value)} data-testid="comunicacion-titulo" />
        </label>
        <label className="block space-y-1 text-sm">Mensaje
          <Textarea value={aviso.mensaje} rows={3} maxLength={600} onChange={(e) => set("mensaje", e.target.value)} data-testid="comunicacion-mensaje" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">Se ve desde
            <Input type="date" value={aviso.desde} onChange={(e) => set("desde", e.target.value)} data-testid="comunicacion-desde" />
          </label>
          <label className="block space-y-1 text-sm">Se ve hasta
            <Input type="date" value={aviso.hasta} min={aviso.desde || undefined} onChange={(e) => set("hasta", e.target.value)} data-testid="comunicacion-hasta" />
          </label>
        </div>
        {errores.length > 0 && (aviso.titulo || aviso.mensaje || aviso.desde || aviso.hasta) && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" data-testid="comunicacion-pendientes">{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
        {v.ok && <p className="text-sm" data-testid="comunicacion-vista-previa">Se verá en pantalla a todo el equipo {periodo(v.aviso)}.</p>}
        {publicar.isError && <p role="alert" className="text-sm text-destructive" data-testid="comunicacion-error-publicar">{(publicar.error as Error).message}</p>}
        {publicado && <p role="status" className="text-sm" data-testid="comunicacion-publicado">Aviso publicado {publicado}. El equipo lo verá al entrar al sistema.</p>}
        <Button type="button" onClick={aprobar} disabled={!v.ok || publicar.isPending} data-testid="comunicacion-publicar">
          {publicar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}Aprobar y publicar
        </Button>
      </section>

      <section className="zen-glass space-y-2 rounded-3xl p-4" aria-label="Avisos publicados">
        <h2 className="text-base font-medium">Avisos recientes</h2>
        {lista.isLoading ? <p className="text-sm text-muted-foreground" role="status">Leyendo los avisos…</p>
          : lista.isError ? <p role="alert" className="text-sm text-destructive" data-testid="comunicacion-error-lista">{(lista.error as Error).message}</p>
          : (lista.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground" data-testid="comunicacion-sin-avisos">Todavía no hay avisos.</p> : (
            <ul className="space-y-1.5" data-testid="comunicacion-lista">
              {(lista.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-background/40 p-2.5 text-sm" data-testid={`aviso-fila-${a.id}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{estadoDe(a, hoy)} · {periodo(a)}{a.redactado_por === "agente" ? " · redactado por el agente" : ""}</span>
                  </span>
                  {a.estado === "publicado" && a.hasta >= hoy && (
                    <button type="button" disabled={cancelar.isPending} onClick={() => cancelar.mutate(a.id)} data-testid={`aviso-cancelar-${a.id}`}
                      className="shrink-0 rounded-full border border-border/60 px-3 py-1 text-xs disabled:opacity-50">Cancelar</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        {cancelar.isError && <p role="alert" className="text-sm text-destructive" data-testid="comunicacion-error-cancelar">{(cancelar.error as Error).message}</p>}
      </section>
    </div>
  );
}
