// Espacio de trabajo (R3 y R4): varias conversaciones a la vez y la lista «En curso». Funciones puras, solo lectura.
import { ETIQUETA_EVENTO, type ActividadPublica, type EventoPublico, type ResumenTarea } from "../../../supabase/functions/_shared/seguimiento";

// DECISIÓN PENDIENTE DE DIRECCIÓN: cuántos agentes se ven a la vez. El requisito y el diseño proponen dos; se usa ese valor de forma provisional.
export const MAX_A_LA_VEZ = 2;
export type ModoEspacio = "una" | "varios";
export const leerModo = (p: string | null | undefined): ModoEspacio => (p === "varios" ? "varios" : "una");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const leerVer = (p: string | null | undefined): string[] => [...new Set((p ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => UUID.test(x)))];

/** Agentes que se ven a la vez: los elegidos (que estén abiertos) hasta el tope; si no hay elección, el activo y luego los demás abiertos. */
export function visiblesAlaVez(abiertos: string[], ver: string[], activo: string, max = MAX_A_LA_VEZ): string[] {
  const elegidos = ver.filter((id) => abiertos.includes(id)).slice(0, max);
  if (elegidos.length > 0) return elegidos;
  return [activo, ...abiertos.filter((id) => id !== activo)].filter((id) => abiertos.includes(id)).slice(0, max);
}
/** Marca o desmarca a un agente; si se pasa del tope, sale el que llevaba más tiempo elegido. */
export function alternarVisible(actuales: string[], id: string, max = MAX_A_LA_VEZ): string[] {
  if (actuales.includes(id)) return actuales.filter((x) => x !== id);
  return [...actuales, id].slice(-max);
}

export const ESTADOS_ACTIVOS = ["pending", "queued", "in_progress", "waiting_approval"];
export interface ConversacionEnCurso { conversacion: string; tareaId: string; agenteId: string | null; agente: string; titulo: string; estado: string; creada: string }

/** Conversaciones con algo en marcha (una por solicitud original), las que trabajan primero y luego las más recientes. */
export function conversacionesEnCurso(lista: ResumenTarea[]): ConversacionEnCurso[] {
  const porId = new Map(lista.map((t) => [t.id, t]));
  const mapa = new Map<string, ConversacionEnCurso>();
  for (const t of lista) {
    if (!ESTADOS_ACTIVOS.includes(t.estado)) continue;
    const conv = t.hilo ?? t.id, previa = mapa.get(conv);
    if (previa && previa.creada >= t.creada) continue;
    mapa.set(conv, { conversacion: conv, tareaId: t.id, agenteId: t.agent_id, agente: t.agente, titulo: porId.get(conv)?.titulo || t.titulo, estado: t.estado, creada: t.creada });
  }
  const peso = (e: string) => (e === "in_progress" ? 0 : e === "waiting_approval" ? 1 : 2);
  return [...mapa.values()].sort((a, b) => peso(a.estado) - peso(b.estado) || b.creada.localeCompare(a.creada));
}

/** Última línea de lo que va haciendo: lo más reciente entre los eventos de avance y las acciones del agente (sin adjuntos sueltos). */
export function ultimaLinea(eventos: EventoPublico[], actividad: ActividadPublica[]): string | null {
  const cand = [
    ...eventos.filter((e) => e.tipo !== "attachment_processed").map((e) => ({ cuando: e.cuando, texto: e.mensaje || ETIQUETA_EVENTO[e.tipo] || e.tipo })),
    ...actividad.map((a) => ({ cuando: a.cuando, texto: a.mensaje || a.accion })),
  ].filter((c) => c.texto);
  cand.sort((a, b) => a.cuando.localeCompare(b.cuando));
  return cand.length ? cand[cand.length - 1].texto : null;
}
/** Avance en %: el último evento que lo trae. «Paso N de M» no existe como dato: lo tendría que publicar la VM (docs/agentes-vm-requisitos.md). */
export function avancePorcentaje(eventos: EventoPublico[]): number | null {
  const con = eventos.filter((e) => e.progreso != null);
  return con.length ? Math.max(0, Math.min(100, Math.round(con[con.length - 1].progreso as number))) : null;
}
