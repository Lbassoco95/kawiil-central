// Mapa «estado real del agente → qué hace en la oficina». Funciones puras, solo lectura.
// Sin eventos de avance (ai_task_events aún no es legible por los usuarios) el estado se deduce de agent_registry + agent_tasks.
import { descripcionAgente, nombreAgente, rolCorto, senalAgente, type AgenteRegistro, type TareaAgente } from "./registro";

export type EstadoOficina = "trabajando" | "celebrando" | "con_error" | "atascado" | "sentado" | "descansando" | "apagado";

const MIN = 60_000, H = 3_600_000;
export const VENTANA_CELEBRA_MS = 15 * MIN;   // una tarea terminada hace menos de esto se celebra
export const VENTANA_ERROR_MS = 24 * H;       // un error más reciente que esto se muestra como error

export const ESTADO_OFICINA: Record<EstadoOficina, { etiqueta: string; frase: string; color: string }> = {
  trabajando: { etiqueta: "Trabajando", frase: "Tiene una tarea en curso.", color: "azul" },
  celebrando: { etiqueta: "Terminó", frase: "Acaba de terminar una tarea.", color: "verde" },
  con_error: { etiqueta: "Algo falló", frase: "Su última tarea no salió como esperábamos.", color: "rosa" },
  atascado: { etiqueta: "Atascado", frase: "Figura trabajando pero no da señal desde hace más de una hora.", color: "rosa" },
  sentado: { etiqueta: "Disponible", frase: "En su escritorio, con señal reciente.", color: "salvia" },
  descansando: { etiqueta: "Descansando", frase: "Sin señal reciente, pero dentro de los últimos 7 días.", color: "arena" },
  apagado: { etiqueta: "Sin señal", frase: "Lleva más de 7 días sin dar señal o nunca la ha dado.", color: "gris" },
};

export function ultimaTarea(agenteId: string, tareas: TareaAgente[]): TareaAgente | undefined {
  return tareas.filter((t) => t.agent_id === agenteId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function estadoOficina(a: AgenteRegistro, tareas: TareaAgente[], ahora: Date): EstadoOficina {
  const senal = senalAgente(a, ahora);
  if (senal === "atascado") return "atascado";
  const propias = tareas.filter((t) => t.agent_id === a.id);
  const ultima = ultimaTarea(a.id, tareas);
  const hace = (iso: string | null) => (iso ? ahora.getTime() - new Date(iso).getTime() : Infinity);
  if (a.status === "error" || (ultima && (ultima.status === "error" || ultima.status === "failed") && hace(ultima.completed_at ?? ultima.created_at) <= VENTANA_ERROR_MS)) return "con_error";
  // Una tarea en curso solo cuenta si el agente da señal (si no, sería un «trabajando» fantasma de hace meses).
  if ((senal === "en_linea") && propias.some((t) => t.status === "in_progress")) return "trabajando";
  if (propias.some((t) => t.status === "completed" && hace(t.completed_at) <= VENTANA_CELEBRA_MS)) return "celebrando";
  if (senal === "en_linea") return "sentado";
  if (senal === "inactivo") return "descansando";
  return "apagado";
}

export interface FiguraOficina {
  id: string; clave: string; nombre: string; estado: EstadoOficina; ultimoLatido: string | null; ultimaTareaAt: string | null;
  tareasBien: number; tareasMal: number; descripcion: string; rol: string;
}

export function figurasOficina(agentes: AgenteRegistro[], tareas: TareaAgente[], ahora: Date): FiguraOficina[] {
  return agentes
    .filter((a) => a.status !== "archived")
    .map((a) => ({
      id: a.id, clave: a.name, nombre: nombreAgente(a), estado: estadoOficina(a, tareas, ahora), ultimoLatido: a.last_heartbeat, ultimaTareaAt: a.last_task_at,
      tareasBien: a.tasks_completed ?? 0, tareasMal: a.tasks_failed ?? 0, descripcion: descripcionAgente(a), rol: rolCorto(a),
    }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre));
}
