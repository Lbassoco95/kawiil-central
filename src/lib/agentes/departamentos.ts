// Plano por departamentos: a qué departamento pertenece cada agente, sus cifras y la geometría isométrica del plano.
// Funciones puras: reciben las filas y la hora, no leen ni escriben nada. Solo cuenta agentes y tareas (nunca títulos ni textos de tareas).
import { nombreAgente, type AgenteRegistro, type TareaAgente } from "./registro";
import type { FiguraOficina } from "./oficina";

export interface Departamento { clave: string; nombre: string; tinte: string }

// Colores suaves (Zen): una isla por departamento. El orden de esta lista es el orden de las claves conocidas.
export const DEPARTAMENTOS: Record<string, Departamento> = {
  juridico: { clave: "juridico", nombre: "Jurídico", tinte: "#d8cbe6" },
  acervo: { clave: "acervo", nombre: "Acervo legal", tinte: "#cbdceb" },
  fiscal: { clave: "fiscal", nombre: "Fiscal y finanzas", tinte: "#efdcb8" },
  cumplimiento: { clave: "cumplimiento", nombre: "Cumplimiento", tinte: "#cfe3cc" },
  gestoria: { clave: "gestoria", nombre: "Gestoría y documentos", tinte: "#f0cfca" },
  marketing: { clave: "marketing", nombre: "Marketing", tinte: "#c9e4de" },
  otros: { clave: "otros", nombre: "Otros", tinte: "#e1dacb" },
};

// Asignación de los agentes actuales por su nombre. Es una decisión de organización, no un dato de la base: se corrige aquí o, sin tocar el código,
// poniendo `config.departamento` (una de las claves de arriba) en el registro del agente, que manda sobre esta tabla.
const POR_NOMBRE: Record<string, string> = {
  amatl: "juridico", tepantli: "juridico", tlahtoani: "juridico", tequitl: "juridico",
  atl: "fiscal", teocuitl: "fiscal", balam: "fiscal", ollin: "fiscal", metztli: "fiscal",
  nelli: "cumplimiento",
  yollotl: "gestoria", coyolli: "gestoria", tlahtolli: "gestoria", tochtli: "gestoria",
};

// Para agentes nuevos (por ejemplo los que crea el Constructor) sin asignación: se deduce de lo que dice su descripción.
const PALABRAS: Array<[RegExp, string]> = [
  [/lavado|pld|kyc|cumplimiento|listas? de personas|sanciones/i, "cumplimiento"],
  [/fiscal|contab|n[oó]mina|financier|\bsat\b|impuesto|tesorer/i, "fiscal"],
  [/litigio|penal|laboral|corporativ|mercantil|demanda|contrato|jur[ií]dic/i, "juridico"],
  [/gestor[ií]a|document|comunicaci|investigaci|redacci/i, "gestoria"],
];

export function departamentoDe(a: Pick<AgenteRegistro, "name" | "description" | "config">): Departamento {
  const manual = (a.config as { departamento?: unknown } | null | undefined)?.departamento;
  if (typeof manual === "string" && Object.prototype.hasOwnProperty.call(DEPARTAMENTOS, manual)) return DEPARTAMENTOS[manual];
  if (a.name.startsWith("marketing_")) return DEPARTAMENTOS.marketing;
  if (a.name.startsWith("legal_")) return DEPARTAMENTOS.acervo;
  if (Object.prototype.hasOwnProperty.call(POR_NOMBRE, a.name)) return DEPARTAMENTOS[POR_NOMBRE[a.name]];
  const texto = `${a.name.replace(/_/g, " ")} ${a.description ?? ""}`;
  for (const [re, clave] of PALABRAS) if (re.test(texto)) return DEPARTAMENTOS[clave];
  return DEPARTAMENTOS.otros;
}

export const MAX_ISLAS = 7;
export interface GrupoDepartamento { depto: Departamento; figuras: FiguraOficina[] }

const PESO_ESTADO: Record<string, number> = { trabajando: 0, atascado: 1, con_error: 1, celebrando: 2, sentado: 3, descansando: 4, apagado: 5 };

/** Agrupa las figuras por departamento: la isla más poblada primero; con más de 7 departamentos, las más chicas se juntan en «Otros». */
export function agruparPorDepartamento(figuras: FiguraOficina[], agentes: AgenteRegistro[]): GrupoDepartamento[] {
  const deAgente = new Map(agentes.map((a) => [a.id, departamentoDe(a)]));
  const mapa = new Map<string, GrupoDepartamento>();
  for (const f of figuras) {
    const d = deAgente.get(f.id) ?? DEPARTAMENTOS.otros;
    (mapa.get(d.clave) ?? mapa.set(d.clave, { depto: d, figuras: [] }).get(d.clave)!).figuras.push(f);
  }
  let grupos = [...mapa.values()].sort((x, y) => (x.depto.clave === "otros" ? 1 : 0) - (y.depto.clave === "otros" ? 1 : 0) || y.figuras.length - x.figuras.length || x.depto.nombre.localeCompare(y.depto.nombre));
  if (grupos.length > MAX_ISLAS) {
    const resto = grupos.slice(MAX_ISLAS - 1), otros = grupos.slice(0, MAX_ISLAS - 1);
    const juntos = [...resto.flatMap((g) => g.figuras), ...(otros.find((g) => g.depto.clave === "otros")?.figuras ?? [])];
    grupos = [...otros.filter((g) => g.depto.clave !== "otros"), { depto: DEPARTAMENTOS.otros, figuras: juntos }].slice(0, MAX_ISLAS);
    grupos = grupos.filter((g, i, v) => v.findIndex((h) => h.depto.clave === g.depto.clave) === i);
  }
  return grupos.map((g) => ({ ...g, figuras: [...g.figuras].sort((p, q) => PESO_ESTADO[p.estado] - PESO_ESTADO[q.estado] || p.nombre.localeCompare(q.nombre)) }));
}

// ── Cifras de cada departamento ───────────────────────────────────────────────────────────────────────────────────────
export const DIAS_HECHAS = 30;
export interface ResumenDepartamento { agentes: number; haciendo: number; enCola: number; hechas: number; conError: number }
const EN_COLA = new Set(["pending", "queued", "waiting_approval"]);

/** Haciendo = tareas en curso; en cola = pendientes, en cola o esperando aprobación; hechas = terminadas en los últimos 30 días; con error = fallidas en 30 días. */
export function resumenDepartamento(ids: string[], tareas: TareaAgente[], ahora: Date): ResumenDepartamento {
  const suyos = new Set(ids), desde = ahora.getTime() - DIAS_HECHAS * 86_400_000;
  const r: ResumenDepartamento = { agentes: ids.length, haciendo: 0, enCola: 0, hechas: 0, conError: 0 };
  for (const t of tareas) {
    if (!t.agent_id || !suyos.has(t.agent_id)) continue;
    if (t.status === "in_progress") r.haciendo++;
    else if (EN_COLA.has(t.status)) r.enCola++;
    else if (t.status === "completed" && t.completed_at && new Date(t.completed_at).getTime() >= desde) r.hechas++;
    else if ((t.status === "error" || t.status === "failed") && new Date(t.completed_at ?? t.created_at).getTime() >= desde) r.conError++;
  }
  return r;
}

// ── Panel «Estado de tareas» ──────────────────────────────────────────────────────────────────────────────────────────
export type FiltroTareas = "todas" | "en_cola" | "en_curso" | "terminadas" | "con_error";
export const FILTROS_TAREAS: Array<{ v: FiltroTareas; t: string }> = [
  { v: "todas", t: "Todas" }, { v: "en_cola", t: "En cola" }, { v: "en_curso", t: "En curso" }, { v: "terminadas", t: "Terminadas" }, { v: "con_error", t: "Con error" },
];
export const grupoDeEstado = (status: string): Exclude<FiltroTareas, "todas"> | null =>
  status === "in_progress" ? "en_curso" : EN_COLA.has(status) ? "en_cola" : status === "completed" ? "terminadas" : status === "error" || status === "failed" ? "con_error" : null;

export function contarTareas(tareas: TareaAgente[]): Record<FiltroTareas, number> {
  const c: Record<FiltroTareas, number> = { todas: 0, en_cola: 0, en_curso: 0, terminadas: 0, con_error: 0 };
  for (const t of tareas) { const g = grupoDeEstado(t.status); if (g) { c[g]++; c.todas++; } }
  return c;
}

export interface FilaTarea { id: string; agenteId: string | null; agente: string; tipo: string; grupo: Exclude<FiltroTareas, "todas">; creada: string; fin: string | null }

/** Las tareas más recientes (primero las en curso, luego por fecha) con el nombre del agente. No lleva títulos ni instrucciones: solo agente, tipo y estado. */
export function filasDeTareas(tareas: TareaAgente[], agentes: AgenteRegistro[], filtro: FiltroTareas, limite = 40): FilaTarea[] {
  const nombres = new Map(agentes.map((a) => [a.id, nombreAgente(a)]));
  const filas: FilaTarea[] = [];
  for (const t of tareas) {
    const grupo = grupoDeEstado(t.status);
    if (!grupo || (filtro !== "todas" && grupo !== filtro)) continue;
    filas.push({ id: t.id, agenteId: t.agent_id, agente: (t.agent_id && nombres.get(t.agent_id)) || "Agente desconocido", tipo: t.task_type, grupo, creada: t.created_at, fin: t.completed_at });
  }
  const peso = (g: FilaTarea["grupo"]) => (g === "en_curso" ? 0 : g === "en_cola" ? 1 : 2);
  return filas.sort((a, b) => peso(a.grupo) - peso(b.grupo) || b.creada.localeCompare(a.creada)).slice(0, limite);
}

// ── Geometría isométrica (proyección 2:1) ─────────────────────────────────────────────────────────────────────────────
export const TW = 56, TH = 28;   // medio ancho y medio alto de una celda en pantalla

/** Filas y columnas de la isla para `n` agentes: lo más cuadrada posible. */
export function celdasDe(n: number): { cols: number; filas: number } {
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(n, 1)))));
  return { cols, filas: Math.max(1, Math.ceil(Math.max(n, 1) / cols)) };
}

/** Punto en pantalla de la celda (i, j) respecto del centro de una isla de cols × filas. (i, j) puede ser fraccionario: 0.5 = centro de la celda. */
export function isoPunto(i: number, j: number, cols: number, filas: number): { x: number; y: number } {
  return { x: (i - j) * TW - ((cols - filas) * TW) / 2, y: (i + j) * TH - ((cols + filas) * TH) / 2 };
}

export const ESCENA = { ancho: 1200, alto: 940, hub: { x: 600, y: 470 } };

/** Centros de las islas: arriba la mitad (redondeando hacia arriba) y abajo el resto, repartidas de forma pareja. */
export function posicionesIslas(n: number): Array<{ x: number; y: number; fila: "arriba" | "abajo" }> {
  const arriba = Math.ceil(n / 2), abajo = n - arriba;
  const fila = (k: number, y: number, lado: "arriba" | "abajo") => Array.from({ length: k }, (_, i) => ({ x: ESCENA.hub.x + (i - (k - 1) / 2) * 360, y, fila: lado }));
  return [...fila(arriba, n === 1 ? ESCENA.hub.y : 310, "arriba"), ...fila(abajo, 640, "abajo")];
}
