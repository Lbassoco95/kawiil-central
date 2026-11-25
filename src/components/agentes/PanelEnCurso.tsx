import { Link } from "react-router-dom";
import { cuandoRelativo } from "@/lib/agentes/registro";
import { ETIQUETA_ESTADO } from "@/lib/agentes/etiquetas";
import { urlChat } from "@/lib/agentes/chat";
import { avancePorcentaje, conversacionesEnCurso, ultimaLinea, type ConversacionEnCurso } from "@/lib/agentes/espacio";
import { useDetalleSeguimiento, useTareasSeguimiento } from "@/hooks/useSeguimientoAgentes";

// Lista «En curso» (R4): las conversaciones activas de todos los agentes, con agente, estado (palabra y marca), última línea y avance. Se actualiza sola
// (la lista se relee cada pocos segundos mientras algo esté en marcha). Al tocar una, se abre su pestaña en el espacio de trabajo; leerla no la detiene.
// El avance es un porcentaje cuando el agente lo reporta; «paso N de M» necesita que la VM lo publique (docs/agentes-vm-requisitos.md).
const MARCA: Record<string, string> = { in_progress: "●", pending: "◌", queued: "◌", waiting_approval: "▲" };

function Fila({ c, abiertos, ahora }: { c: ConversacionEnCurso; abiertos: string[]; ahora: Date }) {
  const d = useDetalleSeguimiento(c.tareaId);
  const linea = d.data ? ultimaLinea(d.data.eventos, d.data.actividad) : null, avance = d.data ? avancePorcentaje(d.data.eventos) : null;
  const e = ETIQUETA_ESTADO[c.estado]?.texto ?? c.estado;
  const href = c.agenteId ? urlChat(c.agenteId, { conv: c.conversacion, abiertos: c.agenteId && abiertos.includes(c.agenteId) ? abiertos : [...abiertos, c.agenteId] }) : null;
  const cuerpo = (
    <>
      <span className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{c.agente}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-xs" data-testid={`encurso-estado-${c.conversacion}`}><span aria-hidden>{MARCA[c.estado] ?? "●"}</span>{e}</span>
        {avance !== null && <span className="text-xs text-muted-foreground" data-testid={`encurso-avance-${c.conversacion}`}>Avance {avance} %</span>}</span>
      <span className="block truncate text-xs text-muted-foreground">{c.titulo || "Solicitud sin título"} · {cuandoRelativo(c.creada, ahora)}</span>
      <span className="block truncate text-xs" data-testid={`encurso-linea-${c.conversacion}`}>{linea ?? "Todavía sin avance registrado."}</span>
    </>
  );
  return (
    <li data-testid={`encurso-${c.conversacion}`}>
      {href ? <Link to={href} className="block min-h-11 rounded-2xl border border-border/50 bg-background/50 px-3 py-2 hover:bg-background/80">{cuerpo}</Link> : <div className="rounded-2xl border border-border/50 px-3 py-2">{cuerpo}</div>}
    </li>
  );
}

export function PanelEnCurso({ abiertos, ahora }: { abiertos: string[]; ahora: Date }) {
  const q = useTareasSeguimiento("todas");
  const lista = conversacionesEnCurso(q.data ?? []);
  return (
    <section className="zen-glass space-y-2 rounded-3xl p-3" aria-label="En curso" data-testid="en-curso">
      <h2 className="text-sm font-medium">En curso · {lista.length}<span className="ml-2 text-xs font-normal text-muted-foreground">se actualiza solo</span></h2>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Leyendo lo que va en curso…</p>
        : q.isError ? <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>
        : lista.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="en-curso-vacio">Nada en curso ahora.</p>
        : <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Conversaciones en curso">{lista.map((c) => <Fila key={c.conversacion} c={c} abiertos={abiertos} ahora={ahora} />)}</ul>}
    </section>
  );
}
