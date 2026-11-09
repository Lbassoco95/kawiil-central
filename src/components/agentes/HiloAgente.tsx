import { useState } from "react";
import { CalendarClock, Download, Loader2, Send, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { useInstruirAgente } from "@/hooks/useAgenteConstructor";
import { useCancelarRevision, useDescargarEntregable, useHilo, useProgramarRevision } from "@/hooks/useSeguimientoAgentes";
import { INSTRUCCION_REVISION, MAX_VECES, REPETICIONES, type MensajeHilo } from "../../../supabase/functions/_shared/seguimiento";
import { ETIQUETA_ESTADO, tamano } from "@/lib/agentes/etiquetas";
import { MarkdownAgente } from "@/components/agentes/MarkdownAgente";
import { AvanceTarea } from "@/components/agentes/AvanceTarea";

// Una solicitud con su conversación: lo que se le pidió al agente, lo que respondió y entregó, y lo que se le sigue pidiendo en el mismo
// hilo (el agente recuerda lo ya hablado). Desde aquí también se programan revisiones («revísalo el lunes», «cada semana»).
// Todo se pinta como texto plano, nunca como HTML. Solo Dirección (los datos vienen de la función `agente-seguimiento`).

const ETIQUETA_REPETIR: Record<string, string> = { diaria: "todos los días", semanal: "cada semana", mensual: "cada mes" };
const pad = (n: number) => String(n).padStart(2, "0");
export const aLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const a9 = (d: Date) => { d.setHours(9, 0, 0, 0); return d; };
export const ATAJOS = (ahora: Date): { t: string; v: string }[] => {
  const man = a9(new Date(ahora)); man.setDate(man.getDate() + 1);
  const lun = a9(new Date(ahora)); lun.setDate(lun.getDate() + ((8 - lun.getDay()) % 7 || 7));
  const sem = a9(new Date(ahora)); sem.setDate(sem.getDate() + 7);
  return [{ t: "Mañana 9:00", v: aLocal(man) }, { t: "Próximo lunes 9:00", v: aLocal(lun) }, { t: "En una semana", v: aLocal(sem) }];
};
export const cuandoLocal = (iso: string) => new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

function Entregables({ m }: { m: MensajeHilo }) {
  const descargar = useDescargarEntregable();
  if (m.entregables.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5" data-testid="hilo-entregables">
      {m.entregables.map((e, i) => (
        <li key={e.nombre + i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{e.nombre}</span><span className="text-xs text-muted-foreground">{tamano(e.bytes)}</span>
          <Button size="sm" variant="outline" disabled={descargar.isPending} data-testid={`hilo-descargar-${m.task_id}-${i}`} onClick={() => descargar.mutate({ taskId: m.task_id, indice: i })}>
            <Download className="mr-1 h-3.5 w-3.5" />Descargar
          </Button>
        </li>
      ))}
      {descargar.isError && <li role="alert" className="text-sm text-destructive">{(descargar.error as Error).message}</li>}
    </ul>
  );
}

function Burbuja({ m, ahora }: { m: MensajeHilo; ahora: Date }) {
  const agente = m.rol === "agente";
  const enCurso = agente && !m.texto && ["pending", "queued", "in_progress", "waiting_approval"].includes(m.estado);
  const falla = agente && (m.estado === "error" || m.estado === "failed");
  return (
    <div className={`flex ${agente ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[92%] rounded-2xl border px-3 py-2 text-sm ${agente ? (falla ? "border-rose-300/70 bg-rose-50/50" : "border-border/60 bg-background/50") : "border-primary/40 bg-primary/10"}`} data-testid={`hilo-msg-${m.rol}`}>
        {m.rol === "revision" && <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><CalendarClock className="h-3 w-3" aria-hidden />Revisión programada</p>}
        {enCurso ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Trabajando… <span className="text-xs">({(ETIQUETA_ESTADO[m.estado]?.texto ?? m.estado).toLowerCase()})</span></p>
          : agente && !falla ? <MarkdownAgente texto={m.texto} /> : <p className="whitespace-pre-wrap">{m.texto}</p>}
        <Entregables m={m} />
        <p className="mt-1 text-xs text-muted-foreground">{agente ? "Agente" : m.rol === "revision" ? "Sistema" : "Tú"} · {cuandoRelativo(m.cuando, ahora)}</p>
      </div>
    </div>
  );
}

function Revisiones({ taskId, ahora, lista }: { taskId: string; ahora: Date; lista: { id: string; cuando: string; repetir: string | null; veces_restantes: number | null; instruccion: string }[] }) {
  const programar = useProgramarRevision();
  const cancelar = useCancelarRevision();
  const [cuando, setCuando] = useState("");
  const [repetir, setRepetir] = useState("");
  const [veces, setVeces] = useState("12");
  const [instruccion, setInstruccion] = useState("");
  const [ok, setOk] = useState(false);
  const enviar = () => {
    setOk(false);
    const ms = new Date(cuando).getTime();
    programar.mutate({ task_id: taskId, cuando: Number.isFinite(ms) ? new Date(ms).toISOString() : "", repetir: repetir || null, ...(repetir ? { veces: Number(veces) } : {}), instruccion: instruccion.trim() || undefined },
      { onSuccess: () => { setOk(true); setCuando(""); setRepetir(""); setInstruccion(""); } });
  };
  return (
    <div className="space-y-3" data-testid="hilo-revisiones">
      {lista.length > 0 && (
        <ul className="space-y-1.5" aria-label="Revisiones pendientes">
          {lista.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/50 p-2 text-sm" data-testid={`revision-${r.id}`}>
              <CalendarClock className="h-4 w-4" aria-hidden />
              <span><strong>{cuandoLocal(r.cuando)}</strong>{r.repetir ? ` · ${ETIQUETA_REPETIR[r.repetir] ?? r.repetir}${r.veces_restantes != null ? ` (${r.veces_restantes} veces)` : ""}` : " · una vez"}</span>
              <Button size="sm" variant="outline" disabled={cancelar.isPending} aria-label="Cancelar revisión" data-testid={`cancelar-${r.id}`} onClick={() => cancelar.mutate(r.id)}><X className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
          {cancelar.isError && <li role="alert" className="text-sm text-destructive">{(cancelar.error as Error).message}</li>}
        </ul>
      )}
      <details className="rounded-2xl border border-border/60 p-3 text-sm">
        <summary className="cursor-pointer font-medium" data-testid="hilo-programar-resumen">Programar una revisión</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">El agente revisará esta solicitud a esa hora, con lo ya hablado, y te dejará su resultado aquí. No inicia sesión en ningún sitio.</p>
          <div className="flex flex-wrap gap-2 text-xs" role="group" aria-label="Atajos">
            {ATAJOS(ahora).map((a) => <button key={a.t} type="button" className="rounded-full border border-border/60 px-3 py-1" data-testid={`atajo-${a.t}`} onClick={() => setCuando(a.v)}>{a.t}</button>)}
          </div>
          <label className="block space-y-1">Fecha y hora<input type="datetime-local" className="w-full rounded-md border border-input bg-background px-3 py-2" value={cuando} onChange={(e) => setCuando(e.target.value)} data-testid="revision-cuando" /></label>
          <div className="flex flex-wrap gap-3">
            <label className="space-y-1">Repetir
              <select className="block rounded-md border border-input bg-background px-3 py-2" value={repetir} onChange={(e) => setRepetir(e.target.value)} data-testid="revision-repetir">
                <option value="">No se repite</option>{REPETICIONES.map((r) => <option key={r} value={r}>{ETIQUETA_REPETIR[r]}</option>)}
              </select></label>
            {repetir && <label className="space-y-1">Veces<input type="number" min={1} max={MAX_VECES} className="block w-24 rounded-md border border-input bg-background px-3 py-2" value={veces} onChange={(e) => setVeces(e.target.value)} data-testid="revision-veces" /></label>}
          </div>
          <label className="block space-y-1">Qué debe revisar (opcional)
            <Textarea rows={2} value={instruccion} onChange={(e) => setInstruccion(e.target.value)} placeholder={INSTRUCCION_REVISION} data-testid="revision-instruccion" /></label>
          {programar.isError && <p role="alert" className="text-sm text-destructive" data-testid="revision-error">{(programar.error as Error).message}</p>}
          {ok && <p role="status" className="text-sm" data-testid="revision-ok">Revisión programada.</p>}
          <Button onClick={enviar} disabled={programar.isPending || !cuando} data-testid="revision-programar">{programar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Programar</Button>
        </div>
      </details>
    </div>
  );
}

export function HiloAgente({ taskId, ahora }: { taskId: string; ahora: Date }) {
  const q = useHilo(taskId);
  const instruir = useInstruirAgente();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Leyendo la solicitud…</p>;
  if (q.isError || !q.data) return <p role="alert" className="text-sm text-destructive">{(q.error as Error | null)?.message ?? "No se pudo leer la solicitud."}</p>;
  const { hilo, mensajes, revisiones, en_curso } = q.data;
  const ultimaTarea = [...mensajes].reverse().find((m) => m.rol === "agente")?.task_id ?? null;   // el avance técnico es el de la última respuesta
  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    instruir.mutate({ agent_id: hilo.agent_id, title: `Seguimiento: ${t.slice(0, 60)}`, instructions: t, hilo_id: hilo.id },
      { onSuccess: () => { setTexto(""); void qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); } });
  };
  return (
    <div className="space-y-3" data-testid="hilo">
      <p className="text-base font-medium">{hilo.titulo || "Solicitud"} <span className="text-sm font-normal text-muted-foreground">· {hilo.agente}</span></p>
      <div className="max-h-[32rem] space-y-2 overflow-auto rounded-2xl border border-border/50 p-3" aria-live="polite" data-testid="hilo-mensajes">
        {mensajes.map((m, i) => <Burbuja key={`${m.task_id}-${m.rol}-${i}`} m={m} ahora={ahora} />)}
      </div>
      {ultimaTarea && (
        <details className="rounded-2xl border border-border/60 p-3 text-sm" data-testid="hilo-avance">
          <summary className="cursor-pointer font-medium">Ver cómo lo trabajó</summary>
          <div className="mt-2"><AvanceTarea taskId={ultimaTarea} ahora={ahora} /></div>
        </details>
      )}
      <div className="space-y-2">
        <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={en_curso ? "Espera a que termine para escribirle de nuevo…" : `Escríbele a ${hilo.agente}: pídele un cambio, otro documento o que siga con el tema…`}
          disabled={en_curso} data-testid="hilo-texto" />
        {instruir.isError && <p role="alert" className="text-sm text-destructive">{(instruir.error as Error).message}</p>}
        <Button onClick={enviar} disabled={!texto.trim() || instruir.isPending || en_curso} data-testid="hilo-enviar">
          {instruir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar
        </Button>
      </div>
      <Revisiones taskId={hilo.id} ahora={ahora} lista={revisiones} />
    </div>
  );
}
