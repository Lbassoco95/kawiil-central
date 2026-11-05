// Vista de los agentes del registro de kawiil-central (agent_registry / agent_tasks), solo lectura.
// Funciones puras: reciben las filas y la hora actual, no leen nada ni escriben nada.
// La VM `kawiil-agents` es quien escribe estas tablas; aquí solo se lee lo que dejó.

export interface AgenteRegistro {
  id: string; name: string; display_name: string | null; description: string | null; role: string | null;
  status: string; kind: string | null; last_heartbeat: string | null; last_task_at: string | null;
  tasks_completed: number | null; tasks_failed: number | null;
  config?: Record<string, unknown> | null;
}
// Solo columnas sin texto de expediente: no se trae título, instrucciones, resultado ni mensaje de error.
export interface TareaAgente {
  id: string; agent_id: string | null; task_type: string; status: string;
  created_at: string; started_at: string | null; completed_at: string | null;
}

export type Senal = "en_linea" | "inactivo" | "sin_senal" | "sin_latido" | "atascado" | "archivado" | "al_dia" | "atrasado" | "con_error" | "disponible";

const H = 3_600_000, D = 86_400_000;
export const UMBRAL_EN_LINEA_MS = 2 * H;       // latido de las últimas 2 horas
export const UMBRAL_ATASCADO_MS = 1 * H;       // "trabajando" sin latido en más de 1 hora
export const UMBRAL_SIN_SENAL_MS = 7 * D;      // sin latido en más de 7 días
export const UMBRAL_DIARIO_MS = 26 * H;        // agentes de sistema con corrida diaria: al día si corrieron en las últimas 26 h
export const esSistema = (a: Pick<AgenteRegistro, "kind">): boolean => a.kind === "system";
// Agentes que no corren a una hora fija sino cuando se les pregunta (el Analista): no pueden estar «atrasados» por falta de preguntas.
export const esBajoDemanda = (a: Pick<AgenteRegistro, "config">): boolean => a.config?.cadencia === "bajo_demanda";
// Los agentes de Marketing son los de sistema cuyo nombre empieza con marketing_ (los demás del registro son de Cerebro / kawiil-agents).
export const esAgenteDeMarketing = (a: Pick<AgenteRegistro, "kind" | "name">): boolean => esSistema(a) && a.name.startsWith("marketing_");

export const nombreAgente = (a: Pick<AgenteRegistro, "name" | "display_name">): string => (a.display_name?.trim() || a.name);

export function senalAgente(a: AgenteRegistro, ahora: Date): Senal {
  if (a.status === "archived") return "archivado";
  if (esSistema(a) && esBajoDemanda(a)) return a.status === "error" ? "con_error" : "disponible";
  if (!a.last_heartbeat) return "sin_latido";
  if (esSistema(a)) {
    // Trabajos programados (Marketing): su cadencia es diaria, no «en línea»; la señal es si corrieron a su hora.
    if (a.status === "error") return "con_error";
    return ahora.getTime() - new Date(a.last_heartbeat).getTime() <= UMBRAL_DIARIO_MS ? "al_dia" : "atrasado";
  }
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
  al_dia: { etiqueta: "Al día", color: "verde" },
  disponible: { etiqueta: "Disponible", color: "verde" },
  atrasado: { etiqueta: "Atrasado", color: "rojo" },
  con_error: { etiqueta: "Con error", color: "rojo" },
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
  // Solo los agentes que escribe la VM kawiil-agents: los de sistema (Marketing) dan latido desde Supabase y no dicen nada de la VM.
  const activos = agentes.filter((a) => a.status !== "archived" && !esSistema(a));
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
const PESO: Record<Senal, number> = { atascado: 0, con_error: 0, atrasado: 0, en_linea: 1, al_dia: 1, disponible: 1, inactivo: 2, sin_senal: 3, sin_latido: 4, archivado: 5 };
export function ordenarAgentes(agentes: AgenteRegistro[], ahora: Date): AgenteRegistro[] {
  return [...agentes].sort((a, b) => PESO[senalAgente(a, ahora)] - PESO[senalAgente(b, ahora)] || nombreAgente(a).localeCompare(nombreAgente(b)));
}

// ── Cumplimiento del objetivo de los agentes de Marketing ───────────────────────────────────────────────────────────
// Sale de las tareas que dejan en agent_tasks (solo las de origen «marketing»: llevan números y códigos, nunca texto de clientes).
export interface TareaMarketing {
  id: string; agent_id: string | null; status: string; completed_at: string | null; result_summary: string | null;
  result: { colchon?: Array<{ red: string; dias: number; color: string }>; verificada?: boolean | null } | null;
}
export interface Cumplimiento { estado: "cumple" | "no_cumple" | "sin_datos"; texto: string }

function horaCDMX(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

export function ultimaTareaDe(a: AgenteRegistro, tareas: TareaMarketing[]): TareaMarketing | undefined {
  return tareas.filter((t) => t.agent_id === a.id).sort((x, y) => (y.completed_at ?? "").localeCompare(x.completed_at ?? ""))[0];
}

export function cumplimiento(a: AgenteRegistro, ultima: TareaMarketing | undefined, ahora: Date): Cumplimiento {
  const metas = (a.config?.metas ?? {}) as Record<string, unknown>;
  if (a.name === "marketing_vigilante") {
    if (!ultima) return { estado: "sin_datos", texto: "Todavía no hay corridas registradas." };
    if (ultima.status === "error") return { estado: "no_cumple", texto: `La última corrida terminó con error${ultima.result_summary ? `: ${ultima.result_summary}` : ""}.` };
    const meta = typeof metas.colchon_verde_dias === "number" ? metas.colchon_verde_dias : 14;
    const bajas = (ultima.result?.colchon ?? []).filter((c) => c.dias < meta);
    if (!ultima.result?.colchon) return { estado: "sin_datos", texto: "La última corrida no trae el colchón por red." };
    return bajas.length === 0 ? { estado: "cumple", texto: `Colchón de ${meta} días o más en las tres redes.` }
      : { estado: "no_cumple", texto: `Colchón bajo la meta de ${meta} días en ${bajas.map((c) => `${c.red} (${c.dias})`).join(", ")}.` };
  }
  if (a.name === "marketing_informe_diario") {
    if (!ultima || !ultima.completed_at) return { estado: "sin_datos", texto: "Todavía no hay informes registrados." };
    if (ultima.status === "error") return { estado: "no_cumple", texto: "El último informe no se pudo generar." };
    const limite = typeof metas.informe_diario_antes_de === "string" ? metas.informe_diario_antes_de : "07:30", hora = horaCDMX(ultima.completed_at);
    return hora <= limite ? { estado: "cumple", texto: `Último informe entregado a las ${hora}, antes de las ${limite}.` }
      : { estado: "no_cumple", texto: `Último informe entregado a las ${hora}, después de las ${limite}.` };
  }
  if (a.name === "marketing_analista") {
    if (!ultima) return { estado: "sin_datos", texto: "Todavía no ha respondido ninguna pregunta." };
    if (ultima.status === "error") return { estado: "no_cumple", texto: "La última pregunta no se pudo responder." };
    if (ultima.result?.verificada === true) return { estado: "cumple", texto: "Su última respuesta tuvo todas las cifras verificadas contra la base." };
    if (ultima.result?.verificada === false) return { estado: "no_cumple", texto: "Su última respuesta tuvo cifras que no se pudieron verificar." };
    return { estado: "sin_datos", texto: "La última respuesta no indica si se verificaron las cifras." };
  }
  if (a.name === "marketing_vigia") {
    if (ultima?.status === "error") return { estado: "no_cumple", texto: `No encontró la corrida${ultima.result_summary ? `: ${ultima.result_summary}` : ""}.` };
    const s = senalAgente(a, ahora);
    if (s === "al_dia") return { estado: "cumple", texto: "Revisó la corrida del día y la encontró." };
    return { estado: "sin_datos", texto: "Todavía no hay revisiones registradas." };
  }
  return { estado: "sin_datos", texto: "" };
}

// ── Módulo «Agentes» ────────────────────────────────────────────────────────────────────────────────────────────────
// El módulo muestra los agentes de Cerebro / kawiil-agents; los de Marketing (marketing_*) tienen su vista en /marketing.
export const agentesDelModulo = (agentes: AgenteRegistro[]): AgenteRegistro[] => agentes.filter((a) => !esAgenteDeMarketing(a));

// ── Salud de los agentes legales (DOF / SCJN) ───────────────────────────────────────────────────────────────────────
// Los agentes legal_* revisan el DOF y la Suprema Corte. Si no dan señal, nadie está revisando: se avisa arriba de todo.
export const esAgenteLegal = (a: Pick<AgenteRegistro, "name">): boolean => a.name.startsWith("legal_");

export interface SaludLegal {
  estado: "ok" | "alerta" | "sin_agentes";
  total: number; sinVida: number;
  sinVidaNombres: Array<{ nombre: string; senal: Senal }>;
}

// «Sin vida» = atascado, sin señal o sin latido. Los archivados no cuentan.
export function saludLegal(agentes: AgenteRegistro[], ahora: Date): SaludLegal {
  const legales = agentes.filter((a) => esAgenteLegal(a) && a.status !== "archived");
  const muertos = legales
    .map((a) => ({ nombre: nombreAgente(a), senal: senalAgente(a, ahora) }))
    .filter((x) => x.senal === "atascado" || x.senal === "sin_senal" || x.senal === "sin_latido");
  return {
    estado: legales.length === 0 ? "sin_agentes" : muertos.length > 0 ? "alerta" : "ok",
    total: legales.length, sinVida: muertos.length, sinVidaNombres: muertos,
  };
}

// El mensaje de error crudo no se muestra: solo su categoría (puede traer texto de expedientes).
export type CategoriaError = "tiempo_agotado" | "recurso_no_disponible" | "conexion" | "otro";
export const ERROR_ETIQUETA: Record<CategoriaError, string> = {
  tiempo_agotado: "Tiempo agotado", recurso_no_disponible: "Recurso no disponible", conexion: "Sin conexión", otro: "Otro error",
};
export function categoriaError(msg: string | null | undefined): CategoriaError {
  const m = (msg ?? "").toLowerCase();
  if (m.includes("timed out") || m.includes("timeout")) return "tiempo_agotado";
  if (m.includes("errno 35") || m.includes("resource temporarily unavailable")) return "recurso_no_disponible";
  if (m.includes("connection") || m.includes("refused") || m.includes("unreachable")) return "conexion";
  return "otro";
}

export interface ErrorTarea { agent_id: string | null; created_at: string; error_message: string | null }
export interface UltimoError { categoria: CategoriaError; etiqueta: string; cuando: string; repeticiones: number }

// Último error de cada agente y cuántas veces se repitió esa misma categoría.
export function ultimoErrorPorAgente(errores: ErrorTarea[]): Map<string, UltimoError> {
  const porAgente = new Map<string, ErrorTarea[]>();
  for (const e of errores) if (e.agent_id) porAgente.set(e.agent_id, [...(porAgente.get(e.agent_id) ?? []), e]);
  const salida = new Map<string, UltimoError>();
  for (const [id, lista] of porAgente) {
    const ordenados = [...lista].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const categoria = categoriaError(ordenados[0].error_message);
    salida.set(id, { categoria, etiqueta: ERROR_ETIQUETA[categoria], cuando: ordenados[0].created_at,
      repeticiones: ordenados.filter((e) => categoriaError(e.error_message) === categoria).length });
  }
  return salida;
}

// ── Respuestas lentas ───────────────────────────────────────────────────────────────────────────────────────────────
// Solo usa fechas de inicio y fin de las tareas (nunca texto). Un agente es «lento» si la mediana de sus últimas tareas
// terminadas pasa de 5 minutos, y «muy lento» si pasa de 10 (el límite de espera observado en la VM es de unos 10 minutos).
export const UMBRAL_LENTO_MS = 5 * 60_000;
export const UMBRAL_MUY_LENTO_MS = 10 * 60_000;
export const TAREAS_PARA_LENTITUD = 5;
export const MIN_TAREAS_PARA_LENTITUD = 2;

export interface AgenteLento { id: string; nombre: string; tareas: number; medianaMs: number; nivel: "lento" | "muy_lento"; mediana: string }

const mediana = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function agentesLentos(agentes: AgenteRegistro[], tareas: TareaAgente[]): AgenteLento[] {
  const salida: AgenteLento[] = [];
  for (const a of agentes) {
    if (a.status === "archived") continue;
    const duraciones = tareas
      .filter((t) => t.agent_id === a.id && t.started_at && t.completed_at && (t.status === "completed" || esFalla(t.status)))
      .sort((x, y) => (y.completed_at as string).localeCompare(x.completed_at as string))
      .slice(0, TAREAS_PARA_LENTITUD)
      .map((t) => new Date(t.completed_at as string).getTime() - new Date(t.started_at as string).getTime())
      .filter((ms) => Number.isFinite(ms) && ms >= 0);
    if (duraciones.length < MIN_TAREAS_PARA_LENTITUD) continue;
    const med = mediana(duraciones);
    if (med < UMBRAL_LENTO_MS) continue;
    salida.push({ id: a.id, nombre: nombreAgente(a), tareas: duraciones.length, medianaMs: med, nivel: med >= UMBRAL_MUY_LENTO_MS ? "muy_lento" : "lento", mediana: duracionLegible(med) });
  }
  return salida.sort((x, y) => y.medianaMs - x.medianaMs);
}
