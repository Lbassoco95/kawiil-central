// Requerimientos «Pendientes de ti» (R6.2): lo que un agente necesita de la persona. Hoy el único dato estructurado que existe es una tarea que espera
// aprobación (`waiting_approval`); «falta una captura» o «permiso bloqueado» necesitan que la VM los registre como pendientes con motivo (ver docs/agentes-requerimientos.md).
// Funciones puras, solo lectura.
import type { ResumenTarea } from "../../../supabase/functions/_shared/seguimiento";

export interface Pendiente { tareaId: string; conversacion: string; agenteId: string | null; agente: string; titulo: string; creada: string }

/** Tareas que esperan a la persona, la más antigua primero (la que lleva más tiempo esperando). Una tarea cumplida deja de estar aquí y queda en el historial de su conversación (R6.6). */
export function pendientesDeTi(lista: ResumenTarea[]): Pendiente[] {
  return lista.filter((t) => t.estado === "waiting_approval")
    .map((t) => ({ tareaId: t.id, conversacion: t.hilo ?? t.id, agenteId: t.agent_id, agente: t.agente, titulo: t.titulo, creada: t.creada }))
    .sort((a, b) => a.creada.localeCompare(b.creada));
}

/** Total de pendientes de todos los agentes, para la franja «Equipo en vivo» (R6.1). Se cuenta por tarea, no por agente. */
export const totalPendientes = (tareas: Array<{ status: string }>): number => tareas.filter((t) => t.status === "waiting_approval").length;
export const textoPendientes = (n: number): string => `${n} ${n === 1 ? "pendiente de ti" : "pendientes de ti"}`;
