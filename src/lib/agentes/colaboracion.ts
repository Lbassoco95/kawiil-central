// Colaboración entre agentes: cuándo un agente le pidió trabajo a otro. El enlace es `source_task_id` (la tarea que originó a esta). Hoy ningún agente lo usa:
// esta lógica deja listo el lugar donde se verá en cuanto empiece. Solo agente, estado y fechas; nunca títulos, instrucciones ni resultados.
import type { TareaAgente } from "./registro";

export const DIAS_COLABORACION = 30;
export interface Llamada { de: string; a: string; veces: number; ultima: string; conError: number }

const esFalla = (s: string) => s === "error" || s === "failed";

/** Pares «agente que pidió → agente que trabajó» de los últimos 30 días, del más frecuente al menos. Ignora enlaces de un agente consigo mismo y padres desconocidos. */
export function llamadasEntreAgentes(tareas: TareaAgente[], ahora: Date): Llamada[] {
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const desde = ahora.getTime() - DIAS_COLABORACION * 86_400_000;
  const mapa = new Map<string, Llamada>();
  for (const t of tareas) {
    if (!t.source_task_id || !t.agent_id || new Date(t.created_at).getTime() < desde) continue;
    const padre = porId.get(t.source_task_id);
    if (!padre?.agent_id || padre.agent_id === t.agent_id) continue;
    const k = `${padre.agent_id}>${t.agent_id}`;
    const l = mapa.get(k) ?? { de: padre.agent_id, a: t.agent_id, veces: 0, ultima: t.created_at, conError: 0 };
    l.veces++; if (esFalla(t.status)) l.conError++; if (t.created_at > l.ultima) l.ultima = t.created_at;
    mapa.set(k, l);
  }
  return [...mapa.values()].sort((x, y) => y.veces - x.veces || y.ultima.localeCompare(x.ultima));
}

/** Quién pidió esta tarea: el id del agente padre, `"desconocido"` si tiene padre pero no está entre las tareas leídas, o null si no viene de otra tarea. */
export function origenDeTarea(t: TareaAgente, tareas: TareaAgente[]): string | null {
  if (!t.source_task_id) return null;
  const padre = tareas.find((x) => x.id === t.source_task_id);
  if (!padre) return "desconocido";
  return padre.agent_id && padre.agent_id !== t.agent_id ? padre.agent_id : null;
}
