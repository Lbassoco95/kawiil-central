// Lista maestra de Personas Bloqueadas (LPB): validación y formato compartidos por la función `agente-lpb` y la pantalla.
// Sin acceso a datos: solo reglas puras (se prueban con vitest).

export const FILTROS = ["por_revisar", "agente_coincide", "agente_discrepa", "agente_no_verificable", "sin_dictamen", "por_corregir", "dudosos", "incompletos", "vigentes", "eliminadas", "revisadas", "todas"] as const;
export type FiltroLpb = (typeof FILTROS)[number];
export const MAX_POR_PAGINA = 100;
export const MAX_REVISION = 50;
export const MAX_EXPORTAR = 2000;

export interface PersonaLpb {
  id: string; nombre: string; rfc: string | null; rfc_dudoso: boolean; tipo_persona: string; estado: string;
  fecha_alta: string | null; fecha_baja: string | null; datos_incompletos: boolean; origen: string;
  revisado: boolean; por_corregir: boolean; revision_nota: string | null; notas: string | null; revisado_en: string | null;
  revision_agente: string | null; revision_agente_nota: string | null; revision_agente_en: string | null;   // dictamen del agente supervisor: una opinión, nunca el visto bueno
}
export interface MovimientoLpb {
  id: string; tipo: string; oficio: string | null; fecha_oficio: string | null; acuerdo: string | null; fundamento: string | null; archivo: string | null; fuente: string;
}
export const CAMPOS_PERSONA = "id, nombre, rfc, rfc_dudoso, tipo_persona, estado, fecha_alta, fecha_baja, datos_incompletos, origen, revisado, por_corregir, revision_nota, notas, revisado_en, revision_agente, revision_agente_nota, revision_agente_en";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;
export const limpiarTexto = (v: unknown, n: number): string => (typeof v === "string" ? v.replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, n) : "");

// Lo que se puede poner en un `or(...)` de PostgREST sin que el usuario inyecte filtros: solo letras, números y espacios.
export const busquedaSegura = (v: unknown): string => limpiarTexto(v, 80).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9Ññ& ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

export function validarListar(b: Record<string, unknown>): { filtro: FiltroLpb; q: string; pagina: number; limite: number } | { error: string } {
  const filtro = (b.filtro ?? "por_revisar") as FiltroLpb;
  if (!FILTROS.includes(filtro)) return { error: "Filtro no válido." };
  const pagina = Number.isInteger(b.pagina) ? Number(b.pagina) : 0;
  if (pagina < 0 || pagina > 10_000) return { error: "Página no válida." };
  const limite = Math.min(Math.max(Number(b.limite) || 50, 1), MAX_POR_PAGINA);
  return { filtro, q: busquedaSegura(b.q), pagina, limite };
}

export function validarRevision(b: Record<string, unknown>): { ids: string[]; decision: "aprobar" | "devolver"; nota: string } | { error: string } {
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids)] : [];
  if (!ids.length || ids.length > MAX_REVISION || !ids.every(esUuid)) return { error: `Elige de 1 a ${MAX_REVISION} personas.` };
  if (b.decision !== "aprobar" && b.decision !== "devolver") return { error: "La decisión debe ser aprobar o devolver." };
  const nota = limpiarTexto(b.nota, 500);
  if (b.decision === "devolver" && nota.length < 3) return { error: "Explica brevemente qué no coincide con el PDF." };
  return { ids: ids as string[], decision: b.decision, nota };
}

// Escapa una celda de CSV y neutraliza fórmulas de Excel (= + - @ al inicio).
export const celdaCsv = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function aCsv(personas: PersonaLpb[]): string {
  const enc = ["Nombre", "RFC", "RFC dudoso", "Tipo", "Estado", "Fecha alta", "Fecha baja", "Datos incompletos", "Origen", "Revisado", "Por corregir", "Nota de revisión", "Dictamen del agente", "Nota del agente"];
  const filas = personas.map((p) => [p.nombre, p.rfc, p.rfc_dudoso ? "sí" : "", p.tipo_persona, p.estado, p.fecha_alta, p.fecha_baja, p.datos_incompletos ? "sí" : "", p.origen, p.revisado ? "sí" : "", p.por_corregir ? "sí" : "", p.revision_nota, p.revision_agente, p.revision_agente_nota]);
  return "﻿" + [enc, ...filas].map((f) => f.map(celdaCsv).join(",")).join("\r\n");
}

export const ETIQUETA_ESTADO: Record<string, string> = { vigente: "Vigente", eliminada: "Eliminada", eliminacion_provisional: "Eliminación provisional" };
export const ETIQUETA_FILTRO: Record<FiltroLpb, string> = {
  por_revisar: "Por revisar", agente_coincide: "Agente: coincide", agente_discrepa: "Agente: discrepa", agente_no_verificable: "Agente: no verificó", sin_dictamen: "Sin dictamen", por_corregir: "Por corregir", dudosos: "RFC dudoso", incompletos: "Datos incompletos", vigentes: "Vigentes", eliminadas: "Eliminadas", revisadas: "Revisadas", todas: "Todas",
};
export const ETIQUETA_DICTAMEN: Record<string, string> = { coincide: "Coincide", no_coincide: "Discrepa", no_verificable: "No verificó" };
