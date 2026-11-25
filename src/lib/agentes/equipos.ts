// Oficinas de equipo: un agente que crea a otros agentes tiene su propia oficina dentro de la sala de su departamento (R1).
// Funciones puras, solo lectura. Todo sale de `agent_registry.config`:
//   · `creado_por`: una persona (texto con su id, como lo escribe hoy el Constructor) o un agente (objeto `{ tipo: "agente", id, para? }`, lo escribe quien crea).
//   · `creado_en`: fecha ISO de la creación.
//   · `para`: el motivo. Si falta, para los agentes del Constructor se usa su misión (`config.mision`).
// No se escribe nada aquí. Un agente sin esos datos sigue en el equipo principal de la sala, como hasta ahora.
import { nombreAgente, type AgenteRegistro } from "./registro";

export interface Creacion { tipo: "persona" | "agente"; creadorId: string | null; cuando: string | null; para: string | null }

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : null;
};
const fechaValida = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(new Date(v).getTime()) ? v : null);

/** Quién creó al agente, cuándo y para qué. Null si el registro no lo dice. */
export function creacionDe(a: Pick<AgenteRegistro, "config">): Creacion | null {
  const c = (a.config ?? null) as Record<string, unknown> | null;
  if (!c || c.creado_por == null) return null;
  const cuando = fechaValida(c.creado_en);
  const mision = texto(c.mision, 200);
  const p = c.creado_por;
  if (typeof p === "string") return p.trim() ? { tipo: "persona", creadorId: p.trim(), cuando, para: mision } : null;
  if (typeof p !== "object" || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  const para = texto(o.para, 200) ?? mision;
  const cuandoObj = fechaValida(o.cuando) ?? cuando;
  if (o.tipo === "agente") return typeof o.id === "string" && o.id ? { tipo: "agente", creadorId: o.id, cuando: cuandoObj, para } : null;
  if (o.tipo === "persona") return { tipo: "persona", creadorId: typeof o.id === "string" ? o.id : null, cuando: cuandoObj, para };
  return null;
}

// Colores de piso de las oficinas. DECISIÓN PENDIENTE DE DIRECCIÓN («color de cada oficina»): mientras no se decida, cada creador toma uno de esta
// paleta provisional, siempre en la gama violeta/rosa, distinta de los tintes de las salas (DEPARTAMENTOS).
export const PALETA_OFICINAS = ["#d6cbf0", "#ecc9e0", "#cdd2f2", "#e3c6ea", "#d2c3e6"];
export const tinteOficina = (jefeId: string): string => {
  let h = 0;
  for (const ch of jefeId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA_OFICINAS[h % PALETA_OFICINAS.length];
};

export interface MiembroOficina { agente: AgenteRegistro; creacion: Creacion }
export interface Oficina {
  jefeId: string; jefeNombre: string; nombre: string; tinte: string;
  miembros: MiembroOficina[];   // del más antiguo al más nuevo
  abierta: string | null;       // cuándo se creó el primer agente de la oficina
}

/** Oficinas que existen: un jefe (agente activo del registro) con al menos un agente activo que él creó. Un agente nunca es su propio jefe. */
export function oficinasDe(agentes: AgenteRegistro[]): Oficina[] {
  const activos = agentes.filter((a) => a.status !== "archived");
  const porId = new Map(activos.map((a) => [a.id, a]));
  const grupos = new Map<string, MiembroOficina[]>();
  for (const a of activos) {
    const c = creacionDe(a);
    if (!c || c.tipo !== "agente" || !c.creadorId || c.creadorId === a.id || !porId.has(c.creadorId)) continue;
    (grupos.get(c.creadorId) ?? grupos.set(c.creadorId, []).get(c.creadorId)!).push({ agente: a, creacion: c });
  }
  const orden = (m: MiembroOficina) => m.creacion.cuando ?? "9999";
  return [...grupos.entries()].map(([jefeId, miembros]) => {
    const jefe = porId.get(jefeId)!;
    const ms = [...miembros].sort((x, y) => orden(x).localeCompare(orden(y)) || nombreAgente(x.agente).localeCompare(nombreAgente(y.agente), "es"));
    return { jefeId, jefeNombre: nombreAgente(jefe), nombre: `Oficina de ${nombreAgente(jefe)}`, tinte: tinteOficina(jefeId), miembros: ms, abierta: ms[0]?.creacion.cuando ?? null };
  }).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
}

/** Ids de los agentes que viven en alguna oficina (no aparecen en el equipo principal de su sala). */
export const idsEnOficinas = (ofs: Oficina[]): Set<string> => new Set(ofs.flatMap((o) => o.miembros.map((m) => m.agente.id)));

/** Un agente nuevo del jefe: oficina de la que es miembro (si es el caso). */
export const oficinaDeMiembro = (id: string, ofs: Oficina[]): Oficina | undefined => ofs.find((o) => o.miembros.some((m) => m.agente.id === id));

export const textoAgentes = (n: number) => `${n} ${n === 1 ? "agente" : "agentes"}`;

// ── Llamadas entre los agentes de una oficina (R1.c.3 y R1.c.4) ─────────────────────────────────────────────
import type { TareaAgente } from "./registro";
export interface LlamadaOficina { id: string; de: string; a: string; estado: "en_curso" | "terminada" | "con_error" | "otra"; tipo: string; cuando: string; conversacionOrigen: string }
const SEMANA_MS = 7 * 86_400_000;
const estadoLlamada = (s: string): LlamadaOficina["estado"] =>
  s === "in_progress" || s === "pending" || s === "queued" || s === "waiting_approval" ? "en_curso" : s === "completed" ? "terminada" : s === "error" || s === "failed" ? "con_error" : "otra";

/** Llamadas reales (tareas con `source_task_id`) en las que ambos agentes son de la oficina. Nada de ejemplo: sin registros, lista vacía. Más reciente primero. */
export function llamadasDeOficina(o: Oficina, tareas: TareaAgente[]): LlamadaOficina[] {
  const ids = new Set([o.jefeId, ...o.miembros.map((m) => m.agente.id)]);
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const lista: LlamadaOficina[] = [];
  for (const t of tareas) {
    if (!t.source_task_id || !t.agent_id) continue;
    const padre = porId.get(t.source_task_id);
    if (!padre?.agent_id || padre.agent_id === t.agent_id || !ids.has(padre.agent_id) || !ids.has(t.agent_id)) continue;
    lista.push({ id: t.id, de: padre.agent_id, a: t.agent_id, estado: estadoLlamada(t.status), tipo: t.task_type, cuando: t.created_at, conversacionOrigen: padre.id });
  }
  return lista.sort((x, y) => y.cuando.localeCompare(x.cuando));
}

export function resumenLlamadas(ls: LlamadaOficina[], ahora: Date): { semana: number; enCurso: number; conError: number } {
  const desde = ahora.getTime() - SEMANA_MS;
  return { semana: ls.filter((l) => new Date(l.cuando).getTime() >= desde).length, enCurso: ls.filter((l) => l.estado === "en_curso").length, conError: ls.filter((l) => l.estado === "con_error").length };
}
