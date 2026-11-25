import { useState } from "react";
import { Link } from "react-router-dom";
import { creacionDe } from "@/lib/agentes/equipos";
import { nombreAgente, type AgenteRegistro } from "@/lib/agentes/registro";
import { urlChat } from "@/lib/agentes/chat";

// Aviso en pantalla cuando un agente crea a otro (R1.e.4): quién lo creó, para qué, cuándo y con qué permisos. Solo en pantalla: sin correo ni mensajes.
// Ofrece ver la oficina y revisar permisos. «Pausar» queda a la vista pero DESACTIVADO hasta que Dirección decida los permisos de un agente creado por otro
// (propuesta: empieza en Solo lectura); mientras tanto el aviso dice que sus permisos aún no están definidos y no inventa un modo.
export const DIAS_AVISO = 14;
const CLAVE = "agentes-aviso-creados-vistos";
const leerVistos = (): string[] => { try { const v = JSON.parse(localStorage.getItem(CLAVE) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const guardarVistos = (v: string[]) => { try { localStorage.setItem(CLAVE, JSON.stringify(v.slice(-100))); } catch { /* sin almacenamiento: el aviso vuelve al recargar */ } };
const cuando = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function agentesCreadosPorAgentes(agentes: AgenteRegistro[], ahora: Date) {
  const desde = ahora.getTime() - DIAS_AVISO * 86_400_000;
  return agentes.flatMap((a) => {
    const c = creacionDe(a), creador = agentes.find((x) => x.id === c?.creadorId);
    if (a.status === "archived" || !c || c.tipo !== "agente" || !c.cuando || new Date(c.cuando).getTime() < desde || !creador) return [];
    return [{ agente: a, creador, creacion: c }];
  }).sort((x, y) => (y.creacion.cuando ?? "").localeCompare(x.creacion.cuando ?? "")).slice(0, 5);
}

export function AvisoAgentesCreados({ agentes, ahora, onVerOficina, onRevisarPermisos }: { agentes: AgenteRegistro[]; ahora: Date; onVerOficina: (jefeId: string) => void; onRevisarPermisos: (agenteId: string) => void }) {
  const [vistos, setVistos] = useState<string[]>(leerVistos);
  const lista = agentesCreadosPorAgentes(agentes, ahora).filter((x) => !vistos.includes(x.agente.id));
  if (lista.length === 0) return null;
  const marcar = (id: string) => { const n = [...vistos, id]; setVistos(n); guardarVistos(n); };
  return (
    <section aria-label="Agentes creados por otros agentes" className="space-y-2" data-testid="aviso-creados">
      {lista.map(({ agente, creador, creacion }) => (
        <div key={agente.id} role="status" className="zen-glass flex flex-wrap items-center gap-3 rounded-3xl border-2 border-violet-400/60 p-4" data-testid={`aviso-creado-${agente.id}`}>
          <div className="min-w-0 flex-1 basis-72 space-y-0.5">
            <p className="text-sm font-semibold">{nombreAgente(creador)} creó a {nombreAgente(agente)}</p>
            <p className="text-sm">Para qué: <span className="text-muted-foreground">{creacion.para ?? "no lo dijo"}</span></p>
            <p className="text-xs text-muted-foreground">Oficina de {nombreAgente(creador)} · {creacion.cuando ? cuando(creacion.cuando) : ""} · Permisos: aún sin definir por Dirección</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onVerOficina(creador.id)} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-ver-${agente.id}`}>Ver en la oficina</button>
            <button type="button" onClick={() => onRevisarPermisos(agente.id)} className="min-h-11 rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-permisos-${agente.id}`}>Revisar permisos</button>
            <Link to={urlChat(agente.id)} className="inline-flex min-h-11 items-center rounded-full border border-border/60 bg-background/70 px-4 text-sm font-medium" data-testid={`aviso-chat-${agente.id}`}>Abrir el chat</Link>
            <button type="button" disabled title="Por activar: depende de la decisión de Dirección sobre los permisos de un agente creado por otro agente" className="min-h-11 rounded-full border border-border/60 px-4 text-sm opacity-60" data-testid={`aviso-pausar-${agente.id}`}>Pausarlo (por activar)</button>
            <button type="button" onClick={() => marcar(agente.id)} className="min-h-11 rounded-full px-3 text-sm underline" data-testid={`aviso-visto-${agente.id}`}>Entendido</button>
          </div>
        </div>
      ))}
    </section>
  );
}
