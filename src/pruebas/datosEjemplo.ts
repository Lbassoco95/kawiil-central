// DATOS DE EJEMPLO del modo de prueba del módulo Agentes. Todo es inventado: ningún dato real. Este archivo solo existe en vistas previas y en desarrollo
// (no entra al build de producción: ver vite.config.ts y docs/agentes-prueba.md). El estado vive en memoria y se pierde al recargar.
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";
import type { EntregablePublico, EventoPublico, MensajeHilo, PlanPublico, ResumenTarea } from "../../supabase/functions/_shared/seguimiento";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const A = { vizumi: id(1), vigilante: id(2), nelli: id(3), sanciones: id(4), amatl: id(5), atl: id(6) };
export const S = { reporte: id(101), listas: id(102), cruce: id(103), llamada: id(104), nelli: id(105), amatl: id(106), llamadaError: id(107) };

export interface Solicitud {
  id: string; agent_id: string; titulo: string; instrucciones: string; estado: string; creada: string; fin: string | null; respuesta: string; error: string;
  entregables: EntregablePublico[]; plan?: PlanPublico; hilo: string | null; source_task_id: string | null; eventos: EventoPublico[]; tipo: string;
}
export interface EstadoEjemplo { agentes: AgenteRegistro[]; solicitudes: Solicitud[]; siguiente: number }

export function crearEstado(ahora = new Date()): EstadoEjemplo {
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();
  const ag = (idA: string, name: string, display: string, descripcion: string, extra: Partial<AgenteRegistro> = {}): AgenteRegistro => ({
    id: idA, name, display_name: display, description: descripcion, role: null, status: "idle", kind: "consultable", last_heartbeat: hace(3), last_task_at: hace(40),
    tasks_completed: 12, tasks_failed: 0, config: {}, ...extra,
  });
  const agentes = [
    ag(A.vizumi, "vizumi_listas_y_kyc_vizum_vizum", "Vizumi", "Revisa listas de personas bloqueadas y KYC de los clientes."),
    ag(A.vigilante, "vigilante_siti", "Vigilante SITI", "Revisa cada día, solo en modo consulta, el SITI AA (requerimientos de la autoridad) y el SITI PLD (avisos).", {
      tasks_completed: 3, config: { creado_por: { tipo: "agente", id: A.vizumi, para: "Revisar cada día el SITI AA y el SITI PLD" }, creado_en: hace(60 * 26) } }),
    ag(A.sanciones, "revisor_sanciones", "Revisor de sanciones", "Cruza clientes contra listas de sanciones.", {
      tasks_completed: 1, config: { creado_por: { tipo: "agente", id: A.vizumi, para: "Cruzar clientes con listas de sanciones" }, creado_en: hace(60 * 5), habilitado: { por: "persona-de-ejemplo", en: hace(60 * 4) } } }),
    ag(A.nelli, "nelli", "Nelli", "Revisa a clientes nuevos (KYC).", { tasks_completed: 30 }),
    ag(A.amatl, "amatl", "Amatl", "Archivista legal: libros corporativos y actas."),
    ag(A.atl, "atl", "Atl", "Calendario fiscal y obligaciones."),
  ];
  const s = (idS: string, agent_id: string, titulo: string, estado: string, o: Partial<Solicitud> = {}): Solicitud => ({
    id: idS, agent_id, titulo, instrucciones: titulo, estado, creada: hace(60), fin: estado === "completed" || estado === "error" ? hace(50) : null, respuesta: "", error: "",
    entregables: [], hilo: null, source_task_id: null, eventos: [], tipo: "manual", ...o,
  });
  const plan: PlanPublico = { fase: "propuesto", objetivo: "Cruzar a todos los clientes activos contra las listas vigentes.", total: 12, sin_carpeta: 1, auxiliares: 2, seguimiento_dias: null,
    criterios: [{ nombre: "Coincidencia exacta", que_verificar: "Nombre completo y fecha de nacimiento", severidad: "alta" }, { nombre: "Coincidencia parcial", que_verificar: "Nombre con variantes", severidad: "media" }],
    supuestos: ["Se usan las listas publicadas hoy."], progreso: { hechas: 0, total: 12, con_error: 0 }, motivo: "", resultado: null };
  const solicitudes: Solicitud[] = [
    s(S.reporte, A.vigilante, "Revisar si hay requerimientos nuevos en SITI AA", "completed", { creada: hace(46), fin: hace(40), tipo: "consulta_siti",
      respuesta: "Revisé SITI AA y SITI PLD.\n\n- SITI AA: sin requerimientos nuevos.\n- SITI PLD: 1 aviso por revisar.\n- No pude consultar Seguimiento y Resolución.",
      entregables: [{ nombre: "Reporte SITI.pdf", formato: "pdf", bytes: 52_000, titulo: "Reporte SITI", creado: hace(40) }] }),
    s(S.listas, A.vizumi, "Revisión de listas de clientes", "in_progress", { creada: hace(12), tipo: "consulta_listas",
      eventos: [{ tipo: "started", secuencia: 1, progreso: 10, cuando: hace(11), mensaje: "" }, { tipo: "thinking", secuencia: 2, progreso: 40, cuando: hace(2), mensaje: "Revisando la lista de personas bloqueadas" }] }),
    s(S.cruce, A.vizumi, "Cruce de listas con sanciones", "waiting_approval", { creada: hace(30), respuesta: "Preparé un plan de trabajo para cruzar a los clientes activos.", plan }),
    s(S.llamada, A.vizumi, "Consultar Seguimiento y Resolución", "completed", { creada: hace(44), fin: hace(41), source_task_id: S.reporte, respuesta: "Consulté Seguimiento y Resolución: sin novedades.", tipo: "consulta_siti" }),
    s(S.llamadaError, A.sanciones, "Verificar una coincidencia", "error", { creada: hace(90), fin: hace(88), source_task_id: S.reporte, error: "No se pudo consultar la lista.", tipo: "consulta_listas" }),
    s(S.nelli, A.nelli, "Revisión de un cliente nuevo", "completed", { creada: hace(200), fin: hace(190), respuesta: "Revisión terminada sin coincidencias." }),
    s(S.amatl, A.amatl, "Libro de actas", "completed", { creada: hace(300), fin: hace(280), respuesta: "Reuní 6 asambleas. Dejé marcadas dos fechas que no coinciden.",
      entregables: [{ nombre: "Libro de actas.docx", formato: "docx", bytes: 214_000, titulo: "Libro de actas", creado: hace(280) }] }),
  ];
  return { agentes, solicitudes, siguiente: 1000 };
}

// ── Lo que devuelven las funciones, armado desde el estado ───────────────────────────────────────────────────────
export const nombreDe = (e: EstadoEjemplo, idA: string | null) => { const a = e.agentes.find((x) => x.id === idA); return a ? a.display_name ?? a.name : "Agente"; };
export const registroTareas = (e: EstadoEjemplo): TareaAgente[] =>
  [...e.solicitudes].sort((a, b) => b.creada.localeCompare(a.creada)).map((x) => ({
    id: x.id, agent_id: x.agent_id, task_type: x.tipo, status: x.estado, created_at: x.creada, started_at: x.creada, completed_at: x.fin, source_task_id: x.source_task_id,
    error_message: x.error || null,
  } as TareaAgente));
export const resumen = (e: EstadoEjemplo, x: Solicitud): ResumenTarea => ({
  id: x.id, agent_id: x.agent_id, agente: nombreDe(e, x.agent_id), titulo: x.titulo, estado: x.estado, tipo: x.tipo, prioridad: "normal", creada: x.creada, inicio: x.creada, fin: x.fin,
  resumen: x.respuesta.slice(0, 200), con_error: x.estado === "error", entregables: x.entregables.length, hilo: x.hilo,
});
export function mensajesDe(x: Solicitud): MensajeHilo[] {
  const out: MensajeHilo[] = [{ task_id: x.id, rol: "persona", texto: x.instrucciones, cuando: x.creada, estado: x.estado, entregables: [] }];
  if (x.estado === "completed") out.push({ task_id: x.id, rol: "agente", estado: x.estado, texto: x.respuesta, cuando: x.fin ?? x.creada, entregables: x.entregables });
  else if (x.estado === "error") out.push({ task_id: x.id, rol: "agente", estado: x.estado, texto: `La tarea no salió como esperábamos: ${x.error || "sin detalle"}`, cuando: x.fin ?? x.creada, entregables: [] });
  else out.push({ task_id: x.id, rol: "agente", estado: x.estado, texto: x.respuesta, cuando: x.creada, entregables: [], ...(x.plan ? { plan: x.plan } : {}) });
  return out;
}
export const ESTADOS_ACTIVOS = ["pending", "queued", "in_progress", "waiting_approval"];
