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

// ── Encargos: revisiones masivas que el agente planea y Dirección aprueba una vez ───────────────────────────────────────
// El plan vive en result.plan de la tarea (lo escribe la VM). Aquí solo se lee lo que la pantalla necesita, acotado y sin ids internos.
export const TIPO_UNIDAD = "encargo_unidad";
export const FASES_PLAN = ["propuesto", "aprobado", "ejecutando", "pausado", "terminado", "cancelado", "reemplazado"] as const;
export type FasePlan = (typeof FASES_PLAN)[number];
export interface PlanPublico {
  fase: FasePlan; objetivo: string; total: number; sin_carpeta: number; auxiliares: number; seguimiento_dias: number | null;
  criterios: { nombre: string; que_verificar: string; severidad: string }[]; supuestos: string[];
  progreso: { hechas: number; total: number; con_error: number }; motivo: string;
  resultado: { clientes: number; al_dia: number; con_pendientes: number; sin_verificar: number; con_error: number } | null;
}
const entero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function planPublico(result: unknown): PlanPublico | null {
  const p = (result as { plan?: unknown } | null | undefined)?.plan as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== "object" || !(FASES_PLAN as readonly unknown[]).includes(p.fase)) return null;
  const al = (p.alcance && typeof p.alcance === "object" ? p.alcance : {}) as Record<string, unknown>;
  const pr = (p.progreso && typeof p.progreso === "object" ? p.progreso : {}) as Record<string, unknown>;
  const rs = p.resultado && typeof p.resultado === "object" ? (p.resultado as Record<string, unknown>) : null;
  const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 30) : []);
  return {
    fase: p.fase as FasePlan, objetivo: truncar(p.objetivo, 600), total: entero(al.total), sin_carpeta: entero(al.sin_carpeta),
    auxiliares: entero(p.auxiliares), seguimiento_dias: typeof p.seguimiento_dias === "number" ? entero(p.seguimiento_dias) : null,
    criterios: lista(p.criterios).map((c) => {
      const x = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      return { nombre: truncar(x.nombre, 120), que_verificar: truncar(x.que_verificar, 400), severidad: truncar(x.severidad, 20) };
    }),
    supuestos: lista(p.supuestos).map((x) => truncar(x, 300)).filter(Boolean),
    progreso: { hechas: entero(pr.hechas), total: entero(pr.total) || entero(al.total), con_error: entero(pr.con_error) },
    motivo: truncar(p.motivo, 300),
    resultado: rs ? { clientes: entero(rs.clientes), al_dia: entero(rs.al_dia), con_pendientes: entero(rs.con_pendientes), sin_verificar: entero(rs.sin_verificar), con_error: entero(rs.con_error) } : null,
  };
}

// Fases en las que Dirección puede decidir: aprobar (o reanudar) y cancelar.
export const FASES_APROBABLES: readonly string[] = ["propuesto", "pausado"];
export const FASES_CANCELABLES: readonly string[] = ["propuesto", "aprobado", "ejecutando", "pausado"];
// ¿La respuesta sigue trabajándose sola? Un plan que espera a una persona (propuesto/pausado) NO cuenta como «en curso».
export const planEnMarcha = (plan: PlanPublico | null): boolean => plan?.fase === "aprobado" || plan?.fase === "ejecutando";

// Cambios al aprobar un plan. Si estaba propuesto empieza desde cero; si estaba pausado se reanuda donde iba (las unidades ya existen).
export function aprobarPlan(result: Record<string, unknown>, userId: string, ahoraIso: string): Record<string, unknown> | null {
  const plan = (result.plan && typeof result.plan === "object" ? result.plan : null) as Record<string, unknown> | null;
  if (!plan || !FASES_APROBABLES.includes(plan.fase as string)) return null;
  const reanuda = plan.fase === "pausado";
  const pr = (plan.progreso && typeof plan.progreso === "object" ? plan.progreso : {}) as Record<string, unknown>;
  const nuevo: Record<string, unknown> = { ...plan, fase: reanuda ? "ejecutando" : "aprobado", aprobado: { por: userId, en: ahoraIso } };
  if (reanuda) { nuevo.progreso = { ...pr, fallas_seguidas: 0 }; delete nuevo.motivo; }
  return { ...result, plan: nuevo };
}

export function cancelarPlan(result: Record<string, unknown>, motivo: string): Record<string, unknown> | null {
  const plan = (result.plan && typeof result.plan === "object" ? result.plan : null) as Record<string, unknown> | null;
  if (!plan || !FASES_CANCELABLES.includes(plan.fase as string)) return null;
  return { ...result, plan: { ...plan, fase: "cancelado", motivo } };
}

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
  plan?: PlanPublico;   // solo en la respuesta de un encargo (plan que espera aprobación, en ejecución o terminado)
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
    const plan = planPublico(r);
    if (plan && plan.fase === "reemplazado") { out.pop(); continue; }       // un plan nuevo lo sustituyó: no se muestra el viejo
    if (TERMINADAS.includes(estado)) {
      const ok = estado === "completed";
      out.push({
        task_id: id, rol: "agente", estado,
        texto: ok ? truncar(r.analysis, 20000) : `La tarea no salió como esperábamos: ${truncar(t.error_message, 300) || "sin detalle"}`,
        cuando: truncar(t.completed_at || t.updated_at || t.created_at, 40), entregables: publicos(entregablesDe(id, t.result)), ...(plan ? { plan } : {}),
      });
    } else if (estado === "cancelled") {
      out.push({ task_id: id, rol: "agente", estado, texto: plan?.motivo || "Tarea cancelada.", cuando: truncar(t.updated_at || t.created_at, 40), entregables: [], ...(plan ? { plan } : {}) });
    } else if (plan) {
      // Encargo propuesto o en ejecución: el texto es lo que el agente explicó al proponerlo; el plan se pinta como tarjeta.
      out.push({ task_id: id, rol: "agente", estado, texto: truncar(r.analysis, 20000), cuando: truncar(t.updated_at || t.created_at, 40), entregables: [], plan });
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

// ── Navegador de los agentes: sitios donde Dirección habilitó ESCRIBIR (config.navegador.escritura) ─────────────────────────────────
// Para cada tarea la persona autoriza (casilla) en cuáles puede escribir el agente; la VM exige esa autorización y nunca amplía lo configurado.
const DOMINIO = /^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
export function dominiosEscritura(config: unknown): string[] {
  const n = (config as { navegador?: { activo?: unknown; escritura?: unknown } } | null | undefined)?.navegador;
  if (!n || n.activo !== true || !Array.isArray(n.escritura)) return [];
  const out: string[] = [];
  for (const d of n.escritura) { const x = typeof d === "string" ? d.trim().toLowerCase() : ""; if (DOMINIO.test(x) && !out.includes(x)) out.push(x); }
  return out;
}
