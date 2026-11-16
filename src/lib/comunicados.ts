// Comunicados internos: vigencia, aviso al entrar y propuestas del agente «Comunicación interna». Lógica pura (sin red ni React), probada aparte.
// Decisión de Dirección (16 nov 2026): el equipo se entera SOLO dentro del sistema (aviso al abrirlo y Hub) y Dirección aprueba cada comunicado.

export type EstadoComunicado = "borrador" | "publicado" | "archivado";
export interface Comunicado {
  id: string; title: string; body: string | null; is_pinned?: boolean; created_at?: string;
  estado?: EstadoComunicado; origen?: "persona" | "agente"; vigente_desde?: string | null; vigente_hasta?: string | null; avisar_al_entrar?: boolean; aprobado_at?: string | null;
}

export const ZONA = "America/Mexico_City";
/** Fecha de hoy en Ciudad de México (AAAA-MM-DD): la vigencia se compara contra ella, no contra la hora del navegador. */
export const hoyCDMX = (ahora: Date = new Date()): string => ahora.toLocaleDateString("en-CA", { timeZone: ZONA });

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Fecha real del calendario (rechaza 2026-02-31 y formatos raros). */
export function esFechaValida(s: unknown): s is string {
  if (typeof s !== "string" || !RE_FECHA.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
}
const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
export const MAX_DIAS_VIGENCIA = 366;
export const MAX_TITULO = 200, MAX_MENSAJE = 4000;

// ---------- Qué se muestra al entrar ----------
/** ¿Está publicado y hoy cae dentro de su vigencia (inclusive en los dos extremos)? */
export const esVigente = (c: Comunicado, hoy: string): boolean =>
  (c.estado ?? "publicado") === "publicado" && !!c.vigente_desde && !!c.vigente_hasta && c.vigente_desde <= hoy && hoy <= c.vigente_hasta;

export const claveVisto = (id: string, hoy: string) => `${id}:${hoy}`;

/** Avisos que se muestran al abrir el sistema hoy: publicados, con «avisar al entrar», vigentes y que esta persona no haya visto hoy. Los fijados van primero. */
export function avisosAlEntrar(lista: Comunicado[], hoy: string, vistos: ReadonlySet<string>): Comunicado[] {
  return lista
    .filter((c) => c.avisar_al_entrar === true && esVigente(c, hoy) && !vistos.has(claveVisto(c.id, hoy)))
    .sort((a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

const CLAVE_ALMACEN = "kawiil:avisos-vistos";
/** Lo que esta persona ya vio hoy en este navegador. Si el navegador no deja guardar (modo privado, datos bloqueados), simplemente se vuelve a mostrar. */
export function leerVistos(hoy: string): Set<string> {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_ALMACEN) ?? "[]");
    return new Set(Array.isArray(crudo) ? crudo.filter((x): x is string => typeof x === "string" && x.endsWith(`:${hoy}`)) : []);
  } catch { return new Set(); }
}
export function marcarVistos(ids: string[], hoy: string): void {
  try {
    const todos = new Set([...leerVistos(hoy), ...ids.map((id) => claveVisto(id, hoy))]); // solo se guarda lo de hoy: lo viejo se limpia solo
    localStorage.setItem(CLAVE_ALMACEN, JSON.stringify([...todos].slice(-100)));
  } catch { /* sin almacenamiento: no pasa nada */ }
}

// ---------- Cómo se ven ----------
// Se arma con las partes sueltas (día de la semana, día, mes, año) porque Intl pone o quita comas según el navegador.
const parte = (opc: Intl.DateTimeFormatOptions, f: string) => new Intl.DateTimeFormat("es-MX", { ...opc, timeZone: "UTC" }).format(new Date(`${f}T12:00:00Z`));
const corto = (f: string) => `${parte({ weekday: "long" }, f)} ${parte({ day: "numeric" }, f)}`;
const legible = (f: string) => `${corto(f)} de ${parte({ month: "long" }, f)} de ${parte({ year: "numeric" }, f)}`;
/** «lunes 16 de noviembre de 2026» o «del lunes 16 al miércoles 18 de noviembre de 2026». */
export function textoVigencia(desde: string | null | undefined, hasta: string | null | undefined): string {
  if (!esFechaValida(desde) || !esFechaValida(hasta)) return "";
  if (desde === hasta) return legible(desde);
  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
  return mismoMes ? `del ${corto(desde)} al ${legible(hasta)}` : `del ${legible(desde)} al ${legible(hasta)}`;
}

export function etiquetaEstado(c: Comunicado): { texto: string; tono: "gris" | "verde" | "amarillo" } {
  const estado = c.estado ?? "publicado";
  if (estado === "borrador") return { texto: "Borrador: espera tu aprobación", tono: "amarillo" };
  if (estado === "archivado") return { texto: "Retirado", tono: "gris" };
  return { texto: c.origen === "agente" ? "Publicado (redactado con el agente)" : "Publicado", tono: "verde" };
}

// ---------- Lo que propone el agente ----------
export interface PropuestaComunicado { titulo: string; mensaje: string; vigente_desde: string | null; vigente_hasta: string | null; avisar_al_entrar: boolean }
// Se quitan los caracteres de control a propósito (texto que viene de un modelo).
// eslint-disable-next-line no-control-regex
const limpio = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();

/** Valida lo que dijo el agente. No confía en nada: todo campo se revisa y lo que no cumple descarta la propuesta (con el mismo criterio que la base). */
export function validarPropuesta(x: unknown): PropuestaComunicado | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.titulo !== "string" || typeof o.mensaje !== "string") return null;
  const titulo = limpio(o.titulo), mensaje = limpio(o.mensaje);
  if (titulo.length < 1 || titulo.length > MAX_TITULO || mensaje.length < 1 || mensaje.length > MAX_MENSAJE) return null;
  const d = o.vigente_desde ?? null, h = o.vigente_hasta ?? null;
  if ((d === null) !== (h === null)) return null;
  if (d !== null && h !== null) {
    if (!esFechaValida(d) || !esFechaValida(h) || h < d || dias(d, h) > MAX_DIAS_VIGENCIA) return null;
  }
  const avisar = o.avisar_al_entrar === undefined ? false : o.avisar_al_entrar;
  if (typeof avisar !== "boolean" || (avisar && d === null)) return null;
  return { titulo, mensaje, vigente_desde: d as string | null, vigente_hasta: h as string | null, avisar_al_entrar: avisar };
}

const RE_BLOQUE = /```comunicado[ \t]*\r?\n([\s\S]*?)```/i;
/** Separa la respuesta del agente en el texto para leer y la propuesta (bloque ```comunicado con un JSON). El bloque nunca se muestra crudo. */
export function extraerPropuesta(texto: string): { texto: string; propuesta: PropuestaComunicado | null; invalida: boolean } {
  const m = RE_BLOQUE.exec(texto);
  if (!m) return { texto, propuesta: null, invalida: false };
  const sinBloque = texto.replace(RE_BLOQUE, "").replace(/\n{3,}/g, "\n\n").trim();
  let datos: unknown = null;
  try { datos = JSON.parse(m[1]); } catch { datos = null; }
  const propuesta = validarPropuesta(datos);
  return { texto: sinBloque, propuesta, invalida: propuesta === null };
}
