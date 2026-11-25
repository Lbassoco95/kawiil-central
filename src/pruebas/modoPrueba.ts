// MODO DE PRUEBA del módulo Agentes: la pantalla funciona con DATOS DE EJEMPLO y no envía ni guarda nada.
// Solo existe en vistas previas y en desarrollo; no entra al build de producción (ver vite.config.ts, `__PRUEBA_DISPONIBLE__`, y docs/agentes-prueba.md).
// Cómo: mientras está activo, este módulo reemplaza en el cliente de Supabase (a) la lectura de las tablas de agentes y (b) las funciones del módulo Agentes por respuestas
// de ejemplo, y bloquea cualquier escritura directa a tablas. Las demás lecturas de la app siguen siendo normales.
import { supabase } from "@/integrations/supabase/client";
import { ESTADOS_ACTIVOS, crearEstado, mensajesDe, nombreDe, registroTareas, resumen, type EstadoEjemplo, type Solicitud } from "./datosEjemplo";
import { estaPausado, soloLectura, conPausa, conHabilitacion } from "../../supabase/functions/_shared/agentePermisos";

export const CLAVE_PRUEBA = "agentes-modo-prueba";
export const FUNCIONES_DE_EJEMPLO = ["agente-seguimiento", "agente-constructor", "dispatch-to-agent", "agente-memoria"];
export const TABLAS_DE_EJEMPLO = ["agent_registry", "agent_tasks", "agent_activity_logs"];
const ESCRITURAS = ["insert", "update", "upsert", "delete"];

export const modoPruebaActivo = (): boolean => { try { return sessionStorage.getItem(CLAVE_PRUEBA) === "1"; } catch { return false; } };
export const activarModoPrueba = () => { try { sessionStorage.setItem(CLAVE_PRUEBA, "1"); } catch { /* sin almacenamiento no hay modo de prueba */ } };
export const salirModoPrueba = () => { try { sessionStorage.removeItem(CLAVE_PRUEBA); } catch { /* nada */ } location.assign("/agentes"); };

type Cuerpo = Record<string, unknown>;
const falla = (mensaje: string) => ({ data: null, error: { message: mensaje, context: { json: async () => ({ error: mensaje }) } } });

/** Responde como lo haría cada función, con el estado de ejemplo. Nunca sale a la red. */
export function responder(e: EstadoEjemplo, funcion: string, body: Cuerpo): { data: unknown; error: null } | ReturnType<typeof falla> {
  const ahora = new Date();
  const idDe = (v: unknown) => (typeof v === "string" ? v : "");
  if (funcion === "agente-seguimiento") {
    const accion = body.action;
    if (accion === "listar") {
      const gr = body.grupo, ag = idDe(body.agent_id);
      const lista = e.solicitudes.filter((x) => (!ag || x.agent_id === ag) && (!gr || (gr === "en_curso" ? ESTADOS_ACTIVOS.includes(x.estado) : true))).sort((a, b) => b.creada.localeCompare(a.creada));
      return { data: { tareas: lista.map((x) => resumen(e, x)) }, error: null };
    }
    const x = e.solicitudes.find((s) => s.id === idDe(body.task_id));
    if (accion === "detalle") {
      if (!x) return falla("No se encontró la tarea.");
      return { data: { tarea: { ...resumen(e, x), instrucciones: x.instrucciones, respuesta: x.respuesta, error: x.error, entregables_lista: x.entregables }, eventos: x.eventos, actividad: [] }, error: null };
    }
    if (accion === "hilo") {
      if (!x) return falla("No se encontró la solicitud.");
      const raiz = x.hilo ? e.solicitudes.find((s) => s.id === x.hilo) ?? x : x;
      const todas = [raiz, ...e.solicitudes.filter((s) => s.hilo === raiz.id)].sort((a, b) => a.creada.localeCompare(b.creada));
      return { data: { hilo: { id: raiz.id, titulo: raiz.titulo, agent_id: raiz.agent_id, agente: nombreDe(e, raiz.agent_id) }, mensajes: todas.flatMap(mensajesDe), revisiones: [],
        en_curso: todas.some((s) => ["pending", "queued", "in_progress"].includes(s.estado)), accesos: [], escritura_dominios: [] }, error: null };
    }
    if (accion === "descargar") return { data: { url: "about:blank", nombre: "Ejemplo", expira_en: 300 }, error: null };
    if (accion === "aprobar_plan" && x?.plan) { x.plan = { ...x.plan, fase: "aprobado" }; x.estado = "in_progress"; return { data: { ok: true, fase: "aprobado" }, error: null }; }
    return { data: { ok: true }, error: null };   // programar_revision, cancelar_revision, cancelar_encargo…: no se guarda nada
  }
  if (funcion === "dispatch-to-agent") {
    const ag = e.agentes.find((a) => a.id === idDe(body.agent_id));
    if (!ag) return falla("Agente no encontrado.");
    if (estaPausado(ag.config)) return falla("El agente está pausado. Reanúdalo para darle tareas.");
    const ctx = (body.input_context && typeof body.input_context === "object" ? body.input_context : {}) as Cuerpo;
    const hilo = idDe(ctx.hilo_id) || null;
    const n: Solicitud = { id: `00000000-0000-4000-8000-${String(e.siguiente++).padStart(12, "0")}`, agent_id: ag.id, titulo: idDe(body.title) || "Solicitud de ejemplo", instrucciones: idDe(body.instructions),
      estado: "queued", creada: ahora.toISOString(), fin: null, respuesta: "", error: "", entregables: [], hilo, source_task_id: null, eventos: [], tipo: "manual" };
    e.solicitudes.push(n);
    return { data: { task_id: n.id }, error: null };
  }
  if (funcion === "agente-constructor") {
    const ag = e.agentes.find((a) => a.id === idDe(body.agent_id));
    if ((body.action === "pausar" || body.action === "habilitar") && ag) {
      if (body.action === "pausar") ag.config = conPausa(ag.config, body.pausado === true, "persona-de-ejemplo", ahora);
      else { const r = conHabilitacion(ag.config, "persona-de-ejemplo", ahora); if ("error" in r) return falla(r.error); ag.config = r.config; }
      return { data: { ok: true }, error: null };
    }
    if (body.action === "chat") return { data: { texto: "Modo de prueba: el Constructor no responde.", propuesta: null, avisos: [] }, error: null };
    return falla("Modo de prueba: no se guarda nada.");
  }
  if (funcion === "agente-memoria") return body.action === "listar" ? { data: { memorias: [] }, error: null } : falla("Modo de prueba: no se guarda nada.");
  return falla("Modo de prueba: función sin respuesta de ejemplo.");
}

/** Constructor de consultas con filas de ejemplo (solo lectura): select, eq, in, order, limit y maybeSingle/single. */
export function consultaDeEjemplo(filas: Record<string, unknown>[]) {
  let rows = [...filas];
  const q: Record<string, unknown> = {};
  const devolver = () => ({ data: rows, error: null });
  q.select = () => q;
  q.eq = (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; };
  q.in = (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; };
  q.order = () => q; q.limit = (n: number) => { rows = rows.slice(0, n); return q; };
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null }); q.single = q.maybeSingle;
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(devolver()).then(ok, ko);
  for (const w of ESCRITURAS) q[w] = () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve(falla("Modo de prueba: no se guarda nada.")).then(ok) });
  return q;
}
/** Cualquier otra tabla se lee normal, pero ninguna escritura sale. */
export function sinEscrituras<T extends object>(constructor: T): T {
  return new Proxy(constructor, { get: (t, p, r) => (typeof p === "string" && ESCRITURAS.includes(p) ? () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve(falla("Modo de prueba: no se guarda nada.")).then(ok) }) : Reflect.get(t, p, r)) });
}

let instalado = false;
export function instalar(cliente: unknown = supabase, estado: EstadoEjemplo = crearEstado()): EstadoEjemplo {
  if (instalado) return estado;
  instalado = true;
  const c = cliente as { from: (t: string) => object; functions: { invoke: (n: string, o?: { body?: Cuerpo }) => Promise<unknown> } };
  const from = c.from.bind(c), invoke = c.functions.invoke.bind(c.functions);
  c.from = (tabla: string) => {
    if (tabla === "agent_registry") return consultaDeEjemplo(estado.agentes as unknown as Record<string, unknown>[]);
    if (tabla === "agent_tasks") return consultaDeEjemplo(registroTareas(estado) as unknown as Record<string, unknown>[]);
    if (tabla === "agent_activity_logs") return consultaDeEjemplo([]);
    return sinEscrituras(from(tabla));
  };
  c.functions.invoke = async (nombre: string, opts?: { body?: Cuerpo }) => (FUNCIONES_DE_EJEMPLO.includes(nombre) ? responder(estado, nombre, opts?.body ?? {}) : invoke(nombre, opts));
  return estado;
}

function bandera() {
  if (typeof document === "undefined" || document.getElementById("modo-prueba-agentes")) return;
  const d = document.createElement("div");
  d.id = "modo-prueba-agentes"; d.setAttribute("role", "status");
  d.style.cssText = "position:sticky;top:0;z-index:99999;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;padding:8px 12px;background:#fde68a;color:#451a03;font:600 13px system-ui,sans-serif";
  d.append("DATOS DE EJEMPLO · Modo de prueba del módulo Agentes: no se envía ni se guarda nada. Se pierde al recargar. ");
  const b = document.createElement("button");
  b.type = "button"; b.textContent = "Salir del modo de prueba"; b.style.cssText = "min-height:44px;padding:0 14px;border-radius:999px;border:1px solid #451a03;background:#fff;font:600 13px system-ui,sans-serif;cursor:pointer";
  b.onclick = salirModoPrueba; d.append(b);
  document.body.prepend(d);
}

/** Se llama al arrancar la app (solo si el build lo incluye): si la sesión está en modo de prueba, instala las respuestas de ejemplo y la bandera. */
export function instalarSiCorresponde() { if (modoPruebaActivo()) { instalar(); bandera(); } }
export { soloLectura };
