// Qué está haciendo un agente y con quién colabora, para la franja «Equipo en vivo» y el escritorio del agente.
// Primera versión: «Trabajando» + el tipo de la tarea en curso si lo hay (no se inventa ningún campo de producción). Nunca títulos, instrucciones ni resultados.
import { ESTADO_OFICINA, type EstadoOficina } from "./oficina";
import { llamadasEntreAgentes } from "./colaboracion";
import type { TareaAgente } from "./registro";

const legible = (tipo: string): string => tipo.replace(/[_-]+/g, " ").trim();

/** Tarea en curso más reciente del agente (la que está haciendo ahora). */
export const tareaEnCurso = (agenteId: string, tareas: TareaAgente[]): TareaAgente | undefined =>
  tareas.filter((t) => t.agent_id === agenteId && t.status === "in_progress").sort((a, b) => (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at))[0];

/** «Trabajando · consulta» si hay tipo de tarea; si no, la etiqueta del estado. */
export function actividadDe(agenteId: string, estado: EstadoOficina, tareas: TareaAgente[]): string {
  const base = ESTADO_OFICINA[estado].etiqueta;
  if (estado !== "trabajando") return base;
  const tipo = tareaEnCurso(agenteId, tareas)?.task_type;
  return tipo && legible(tipo) ? `${base} · ${legible(tipo)}` : base;
}

/** Cuántas tareas de este agente esperan la aprobación de Dirección («te espera»). */
export const esperasDe = (agenteId: string, tareas: TareaAgente[]): number => tareas.filter((t) => t.agent_id === agenteId && t.status === "waiting_approval").length;
export const agentesQueEsperan = (tareas: TareaAgente[]): Set<string> => new Set(tareas.filter((t) => t.status === "waiting_approval" && t.agent_id).map((t) => t.agent_id as string));

export interface Enlace { id: string; veces: number }
/** Quién le pasó trabajo a este agente y a quién se lo pasó él (últimos 30 días). */
export function colaboracionDe(agenteId: string, tareas: TareaAgente[], ahora: Date): { recibioDe: Enlace[]; pasoA: Enlace[] } {
  const ls = llamadasEntreAgentes(tareas, ahora);
  return {
    recibioDe: ls.filter((l) => l.a === agenteId).map((l) => ({ id: l.de, veces: l.veces })),
    pasoA: ls.filter((l) => l.de === agenteId).map((l) => ({ id: l.a, veces: l.veces })),
  };
}

/** Cuánto falta para el siguiente nivel (null si ya es Experto). */
export function progresoNivel(tareasHechas: number | null | undefined): { hechas: number; siguiente: number | null; faltan: number | null } {
  const h = Math.max(0, Math.floor(tareasHechas ?? 0));
  const siguiente = h < 10 ? 10 : h < 25 ? 25 : null;
  return { hechas: h, siguiente, faltan: siguiente === null ? null : siguiente - h };
}
