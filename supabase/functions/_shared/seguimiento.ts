// Seguimiento de tareas de agentes y entregables: reglas puras (sin red ni base) para poder probarlas.
// Las usa la función `agente-seguimiento` (solo Dirección) y las pruebas de la pantalla.

export const BUCKET_ENTREGABLES = "agent-entregables";
export const FORMATOS_ENTREGABLE = ["docx", "xlsx", "pdf"] as const;
export type FormatoEntregable = (typeof FORMATOS_ENTREGABLE)[number];

export interface Entregable { nombre: string; formato: FormatoEntregable; ruta: string; bytes: number; titulo: string; creado: string }
export type EntregablePublico = Omit<Entregable, "ruta">;

export const truncar = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

// Estados reales de agent_tasks (la VM escribe unos y el despacho otros), agrupados para el filtro de la pantalla.
export const GRUPOS_ESTADO = {
  en_curso: ["pending", "queued", "in_progress", "waiting_approval"],
  terminadas: ["completed"],
  con_error: ["error", "failed"],
  canceladas: ["cancelled"],
} as const;
export type GrupoEstado = keyof typeof GRUPOS_ESTADO;

export function estadosDelGrupo(g: unknown): string[] | null {
  return typeof g === "string" && Object.prototype.hasOwnProperty.call(GRUPOS_ESTADO, g) ? [...GRUPOS_ESTADO[g as GrupoEstado]] : null;
}

export const esUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// La ruta guardada en la tarea la escribió la VM; aun así se revalida antes de firmar: debe colgar de la carpeta de ESA tarea.
export function rutaValida(taskId: string, ruta: unknown): ruta is string {
  return typeof ruta === "string" && esUuid(taskId) && ruta.length <= 300 && ruta.startsWith(`${taskId}/`)
    && !ruta.includes("..") && !ruta.includes("\\") && !ruta.includes("//") && !/[\x00-\x1f]/.test(ruta);
}

export function entregablesDe(taskId: string, result: unknown): Entregable[] {
  const lista = (result as { entregables?: unknown } | null | undefined)?.entregables;
  if (!Array.isArray(lista)) return [];
  const out: Entregable[] = [];
  for (const e of lista.slice(0, 20)) {
    const x = e as Record<string, unknown> | null;
    if (!x || typeof x !== "object") continue;
    if (!(FORMATOS_ENTREGABLE as readonly string[]).includes(x.formato as string)) continue;
    if (!rutaValida(taskId, x.ruta)) continue;
    out.push({
      nombre: truncar(x.nombre, 120) || "documento", formato: x.formato as FormatoEntregable, ruta: x.ruta as string,
      bytes: typeof x.bytes === "number" && x.bytes >= 0 ? x.bytes : 0, titulo: truncar(x.titulo, 150), creado: truncar(x.creado, 40),
    });
  }
  return out;
}

export const publicos = (es: Entregable[]): EntregablePublico[] => es.map(({ ruta: _ruta, ...resto }) => resto);

export interface EventoPublico { tipo: string; secuencia: number; progreso: number | null; cuando: string; mensaje: string }
export function limpiarEvento(ev: Record<string, unknown>): EventoPublico {
  const p = (ev.payload && typeof ev.payload === "object" ? ev.payload : {}) as Record<string, unknown>;
  return {
    tipo: truncar(ev.event_type, 60), secuencia: typeof ev.sequence === "number" ? ev.sequence : 0,
    progreso: typeof ev.progress === "number" ? ev.progress : null, cuando: truncar(ev.created_at, 40), mensaje: truncar(p.message, 240),
  };
}

export interface ActividadPublica { accion: string; mensaje: string; nivel: string; cuando: string }
export function limpiarActividad(a: Record<string, unknown>): ActividadPublica {
  return { accion: truncar(a.action, 60), mensaje: truncar(a.message, 240), nivel: truncar(a.level, 20), cuando: truncar(a.created_at, 40) };
}

export interface ResumenTarea {
  id: string; agent_id: string | null; agente: string; titulo: string; estado: string; tipo: string; prioridad: string;
  creada: string; inicio: string | null; fin: string | null; resumen: string; con_error: boolean; entregables: number;
}
export function resumirTarea(t: Record<string, unknown>, nombreAgente: string): ResumenTarea {
  const id = String(t.id ?? "");
  return {
    id, agent_id: typeof t.agent_id === "string" ? t.agent_id : null, agente: nombreAgente, titulo: truncar(t.title, 200),
    estado: truncar(t.status, 30), tipo: truncar(t.task_type, 40), prioridad: truncar(t.priority, 20), creada: truncar(t.created_at, 40),
    inicio: typeof t.started_at === "string" ? t.started_at : null, fin: typeof t.completed_at === "string" ? t.completed_at : null,
    resumen: truncar(t.result_summary, 300), con_error: t.status === "error" || t.status === "failed", entregables: entregablesDe(id, t.result).length,
  };
}

// Detalle completo (solo Dirección): instrucciones, respuesta, error y entregables SIN la ruta interna del archivo.
export function detalleTarea(t: Record<string, unknown>, nombreAgente: string) {
  const id = String(t.id ?? "");
  const r = (t.result && typeof t.result === "object" ? t.result : {}) as Record<string, unknown>;
  return {
    ...resumirTarea(t, nombreAgente),
    instrucciones: truncar(t.instructions || t.description, 8000),
    respuesta: truncar(r.analysis, 20000),
    error: truncar(t.error_message, 600),
    entregables_lista: publicos(entregablesDe(id, t.result)),
  };
}

export const ETIQUETA_EVENTO: Record<string, string> = {
  started: "Empezó la tarea", attachments_processing_started: "Revisando adjuntos", attachments_processing_completed: "Adjuntos revisados",
  attachment_processed: "Adjunto revisado", thinking: "Analizando", response_generated: "Respuesta lista", completed: "Terminó", failed: "Falló",
  insight_generation_started: "Extrayendo aprendizajes", insight_written: "Aprendizaje guardado",
};
