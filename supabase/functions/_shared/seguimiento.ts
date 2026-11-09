// Seguimiento de tareas de agentes y entregables: reglas puras (sin red ni base) para poder probarlas.
// Las usa la función `agente-seguimiento` (solo Dirección) y las pruebas de la pantalla.
import { pareceSecreto } from "./agenteConstructor.ts";

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
  hilo: string | null;   // id de la solicitud original si es un seguimiento o una revisión; null si ella misma es la raíz
}
export function resumirTarea(t: Record<string, unknown>, nombreAgente: string): ResumenTarea {
  const id = String(t.id ?? "");
  return {
    id, agent_id: typeof t.agent_id === "string" ? t.agent_id : null, agente: nombreAgente, titulo: truncar(t.title, 200),
    estado: truncar(t.status, 30), tipo: truncar(t.task_type, 40), prioridad: truncar(t.priority, 20), creada: truncar(t.created_at, 40),
    inicio: typeof t.started_at === "string" ? t.started_at : null, fin: typeof t.completed_at === "string" ? t.completed_at : null,
    resumen: truncar(t.result_summary, 300), con_error: t.status === "error" || t.status === "failed", entregables: entregablesDe(id, t.result).length,
    hilo: esUuid(t.hilo) ? (t.hilo as string).toLowerCase() : null,
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

// ── Hilos: una solicitud con su conversación ──────────────────────────────────────────────────────────────────────────
// Un hilo es la tarea original más los mensajes de seguimiento que se le mandan al agente. Cada mensaje es una tarea normal con
// `input_context.hilo_id` = id de la tarea original (la VM lee ese id y le da al agente lo ya hablado). No hay tabla nueva.
export const TIPO_REVISION = "revision_programada";

export function raizDelHilo(t: Record<string, unknown>): string {
  const ctx = t.input_context as { hilo_id?: unknown } | null | undefined;
  return esUuid(ctx?.hilo_id) ? (ctx!.hilo_id as string).toLowerCase() : String(t.id ?? "");
}

export interface MensajeHilo {
  task_id: string; rol: "persona" | "revision" | "agente"; texto: string; cuando: string; estado: string; entregables: EntregablePublico[];
}
const TERMINADAS = ["completed", "error", "failed"];

// Mensajes en orden: cada tarea es una pregunta (persona, o «revisión» si la programada se ejecutó) y su respuesta (agente).
// Las revisiones futuras (pendientes) no son mensajes: se listan aparte.
export function mensajesDelHilo(tareas: Record<string, unknown>[]): MensajeHilo[] {
  const out: MensajeHilo[] = [];
  const ordenadas = [...tareas].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  for (const t of ordenadas) {
    const id = String(t.id ?? ""), estado = truncar(t.status, 30);
    const esRevision = t.task_type === TIPO_REVISION;
    if (esRevision && estado === "pending") continue;
    out.push({ task_id: id, rol: esRevision ? "revision" : "persona", texto: truncar(t.instructions || t.description, 4000), cuando: truncar(t.created_at, 40), estado, entregables: [] });
    const r = (t.result && typeof t.result === "object" ? t.result : {}) as Record<string, unknown>;
    if (TERMINADAS.includes(estado)) {
      const ok = estado === "completed";
      out.push({
        task_id: id, rol: "agente", estado,
        texto: ok ? truncar(r.analysis, 20000) : `La tarea no salió como esperábamos: ${truncar(t.error_message, 300) || "sin detalle"}`,
        cuando: truncar(t.completed_at || t.updated_at || t.created_at, 40), entregables: publicos(entregablesDe(id, t.result)),
      });
    } else if (estado === "cancelled") {
      out.push({ task_id: id, rol: "agente", estado, texto: "Tarea cancelada.", cuando: truncar(t.updated_at || t.created_at, 40), entregables: [] });
    } else {
      out.push({ task_id: id, rol: "agente", estado, texto: "", cuando: truncar(t.created_at, 40), entregables: [] });   // en curso: la pantalla muestra «Trabajando…»
    }
  }
  return out;
}

export interface RevisionPendiente { id: string; cuando: string; repetir: string | null; veces_restantes: number | null; instruccion: string }
export function revisionesPendientes(tareas: Record<string, unknown>[]): RevisionPendiente[] {
  const out: RevisionPendiente[] = [];
  for (const t of tareas) {
    if (t.task_type !== TIPO_REVISION || t.status !== "pending") continue;
    const c = (t.input_context && typeof t.input_context === "object" ? t.input_context : {}) as Record<string, unknown>;
    if (typeof c.ejecutar_en !== "string") continue;
    out.push({
      id: String(t.id ?? ""), cuando: c.ejecutar_en, repetir: typeof c.repetir === "string" ? c.repetir : null,
      veces_restantes: typeof c.veces_restantes === "number" ? c.veces_restantes : null, instruccion: truncar(t.instructions, 300),
    });
  }
  return out.sort((a, b) => a.cuando.localeCompare(b.cuando));
}

// ── Revisiones programadas ────────────────────────────────────────────────────────────────────────────────────────────
export const REPETICIONES = ["diaria", "semanal", "mensual"] as const;
export type Repeticion = (typeof REPETICIONES)[number];
export const MAX_REVISIONES_POR_HILO = 10;
export const MAX_REVISIONES_POR_AGENTE = 30;
export const MIN_ANTICIPACION_MS = 5 * 60_000;
export const MAX_ANTICIPACION_MS = 400 * 86_400_000;
export const MAX_VECES = 52;
export const INSTRUCCION_REVISION = "Revisa el avance de esta solicitud: dime qué cambió desde la última vez, qué sigue pendiente y qué recomiendas hacer.";

export interface RevisionValida { cuando: string; instruccion: string; repetir: Repeticion | null; veces: number | null }
export type ResultadoRevision = { ok: true; revision: RevisionValida } | { ok: false; errores: string[] };

export function validarRevision(raw: unknown, ahoraMs: number): ResultadoRevision {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errores: string[] = [];
  const ms = typeof o.cuando === "string" ? Date.parse(o.cuando) : NaN;
  if (!Number.isFinite(ms)) errores.push("Falta la fecha y hora de la revisión.");
  else if (ms < ahoraMs + MIN_ANTICIPACION_MS) errores.push("La revisión debe ser al menos 5 minutos en el futuro.");
  else if (ms > ahoraMs + MAX_ANTICIPACION_MS) errores.push("La revisión no puede ser a más de un año.");
  const repetir = o.repetir === undefined || o.repetir === null || o.repetir === "" ? null : o.repetir;
  if (repetir !== null && !(REPETICIONES as readonly unknown[]).includes(repetir)) errores.push("La repetición debe ser diaria, semanal o mensual.");
  let veces: number | null = null;
  if (repetir !== null) {
    const v = o.veces === undefined || o.veces === null || o.veces === "" ? 12 : Number(o.veces);
    if (!Number.isInteger(v) || v < 1 || v > MAX_VECES) errores.push(`Las veces deben ser un número entero de 1 a ${MAX_VECES}.`);
    else veces = v;
  }
  const texto = typeof o.instruccion === "string" ? o.instruccion.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim() : "";
  if (texto.length > 2000) errores.push("La instrucción es demasiado larga (máximo 2 000 caracteres).");
  if (texto && pareceSecreto(texto)) errores.push("La instrucción parece contener una contraseña o llave: no se guarda. Usa 1Password.");
  if (errores.length) return { ok: false, errores };
  return { ok: true, revision: { cuando: new Date(ms).toISOString().slice(0, 19) + "Z", instruccion: texto || INSTRUCCION_REVISION, repetir: repetir as Repeticion | null, veces } };
}

// input_context de la revisión: el hilo, la hora (UTC) y la serie. Sin accesos de 1Password: una revisión programada nunca inicia sesión.
export function contextoRevision(hiloId: string, r: RevisionValida, userId: string): Record<string, unknown> {
  return { hilo_id: hiloId, ejecutar_en: r.cuando, repetir: r.repetir, ...(r.veces !== null ? { veces_restantes: r.veces } : {}), fallas: 0, programada_por: userId };
}
