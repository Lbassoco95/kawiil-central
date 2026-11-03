// Vista de los agentes del registro de kawiil-central (agent_registry / agent_tasks), solo lectura.
// Funciones puras: reciben las filas y la hora actual, no leen nada ni escriben nada.
// La VM `kawiil-agents` es quien escribe estas tablas; aquí solo se lee lo que dejó.

export interface AgenteRegistro {
  id: string; name: string; display_name: string | null; description: string | null; role: string | null;
  status: string; kind: string | null; last_heartbeat: string | null; last_task_at: string | null;
  tasks_completed: number | null; tasks_failed: number | null;
}
// Solo columnas sin texto de expediente: no se trae título, instrucciones, resultado ni mensaje de error.
export interface TareaAgente {
  id: string; agent_id: string | null; task_type: string; status: string;
  created_at: string; started_at: string | null; completed_at: string | null;
}

export type Senal = "en_linea" | "inactivo" | "sin_senal" | "sin_latido" | "atascado" | "archivado";

const H = 3_600_000, D = 86_400_000;
export const UMBRAL_EN_LINEA_MS = 2 * H;       // latido de las últimas 2 horas
export const UMBRAL_ATASCADO_MS = 1 * H;       // "trabajando" sin latido en más de 1 hora
export const UMBRAL_SIN_SENAL_MS = 7 * D;      // sin latido en más de 7 días

export const nombreAgente = (a: Pick<AgenteRegistro, "name" | "display_name">): string => (a.display_name?.trim() || a.name);

export function senalAgente(a: AgenteRegistro, ahora: Date): Senal {
  if (a.status === "archived") return "archivado";
  if (!a.last_heartbeat) return "sin_latido";
  const edad = ahora.getTime() - new Date(a.last_heartbeat).getTime();
  if (a.status === "working" && edad > UMBRAL_ATASCADO_MS) return "atascado";
  if (edad <= UMBRAL_EN_LINEA_MS) return "en_linea";
  if (edad <= UMBRAL_SIN_SENAL_MS) return "inactivo";
  return "sin_senal";
}

export const SENAL_ETIQUETA: Record<Senal, { etiqueta: string; color: string }> = {
  en_linea: { etiqueta: "En línea", color: "verde" },
  inactivo: { etiqueta: "Inactivo", color: "amarillo" },
  sin_senal: { etiqueta: "Sin señal", color: "rojo" },
  sin_latido: { etiqueta: "Sin latido", color: "gris" },
  atascado: { etiqueta: "Atascado", color: "rojo" },
  archivado: { etiqueta: "Archivado", color: "gris" },
};

// Porcentaje de tareas terminadas bien (completadas / (completadas + fallidas)). null si nunca terminó una.
export function tasaExito(a: Pick<AgenteRegistro, "tasks_completed" | "tasks_failed">): number | null {
  const ok = a.tasks_completed ?? 0, mal = a.tasks_failed ?? 0;
  return ok + mal === 0 ? null : Math.round((ok / (ok + mal)) * 100);
}

export function cuandoRelativo(iso: string | null | undefined, ahora: Date): string {
  if (!iso) return "nunca";
  const ms = Math.max(0, ahora.getTime() - new Date(iso).getTime());
  if (ms < 60_000) return "ahora";
  if (ms < H) return `hace ${Math.round(ms / 60_000)} min`;
  if (ms < D) return `hace ${Math.round(ms / H)} h`;
  const dias = Math.floor(ms / D);
  if (dias < 60) return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
  const meses = Math.floor(dias / 30);
  return `hace ${meses} meses`;
}

export interface ResumenServicio {
  estado: "en_linea" | "sin_senal" | "sin_datos";
  ultimoLatido: string | null; activos: number; enLinea: number; atascados: number; sinSenal: number;
}

// ¿Está escribiendo el servicio kawiil-agents? Se deduce del latido más reciente de cualquier agente activo.
export function resumenServicio(agentes: AgenteRegistro[], ahora: Date): ResumenServicio {
  const activos = agentes.filter((a) => a.status !== "archived");
  const latidos = activos.map((a) => a.last_heartbeat).filter((x): x is string => !!x).sort();
  const ultimoLatido = latidos.at(-1) ?? null;
  const senales = activos.map((a) => senalAgente(a, ahora));
  const enLinea = senales.filter((s) => s === "en_linea").length;
  return {
    estado: !ultimoLatido ? "sin_datos" : ahora.getTime() - new Date(ultimoLatido).getTime() <= UMBRAL_EN_LINEA_MS ? "en_linea" : "sin_senal",
    ultimoLatido, activos: activos.length, enLinea,
    atascados: senales.filter((s) => s === "atascado").length,
    sinSenal: senales.filter((s) => s === "sin_senal" || s === "sin_latido").length,
  };
}

export const ESTADO_TAREA: Record<string, { etiqueta: string; falla: boolean }> = {
  pending: { etiqueta: "Pendiente", falla: false }, in_progress: { etiqueta: "En curso", falla: false },
  completed: { etiqueta: "Completada", falla: false }, error: { etiqueta: "Con error", falla: true }, failed: { etiqueta: "Con error", falla: true },
};
export const esFalla = (status: string): boolean => ESTADO_TAREA[status]?.falla ?? false;

export function duracionLegible(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (ms < H) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round((ms / H) * 10) / 10} h`;
}

export interface TareaVista {
  id: string; agenteId: string | null; agente: string; tipo: string; estado: string; etiqueta: string; falla: boolean;
  creada: string; duracion: string | null;
}

// Tareas recientes con el nombre del agente. `dias = null` = todo el historial.
export function tareasRecientes(
  tareas: TareaAgente[], agentes: AgenteRegistro[], ahora: Date,
  f: { dias: number | null; agenteId?: string | null; soloFallas?: boolean; limite?: number } = { dias: 30 },
): TareaVista[] {
  const nombres = new Map(agentes.map((a) => [a.id, nombreAgente(a)]));
  const desde = f.dias === null ? -Infinity : ahora.getTime() - f.dias * D;
  return tareas
    .filter((t) => new Date(t.created_at).getTime() >= desde)
    .filter((t) => !f.agenteId || t.agent_id === f.agenteId)
    .filter((t) => !f.soloFallas || esFalla(t.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, f.limite ?? 100)
    .map((t) => {
      const e = ESTADO_TAREA[t.status];
      const dur = t.started_at && t.completed_at ? new Date(t.completed_at).getTime() - new Date(t.started_at).getTime() : null;
      return {
        id: t.id, agenteId: t.agent_id, agente: (t.agent_id && nombres.get(t.agent_id)) || "Agente desconocido",
        tipo: t.task_type, estado: t.status, etiqueta: e?.etiqueta ?? t.status, falla: e?.falla ?? false,
        creada: t.created_at, duracion: dur === null ? null : duracionLegible(dur),
      };
    });
}

// Orden de las tarjetas: primero lo que necesita atención, luego lo activo, al final lo archivado.
const PESO: Record<Senal, number> = { atascado: 0, en_linea: 1, inactivo: 2, sin_senal: 3, sin_latido: 4, archivado: 5 };
export function ordenarAgentes(agentes: AgenteRegistro[], ahora: Date): AgenteRegistro[] {
  return [...agentes].sort((a, b) => PESO[senalAgente(a, ahora)] - PESO[senalAgente(b, ahora)] || nombreAgente(a).localeCompare(nombreAgente(b)));
}
