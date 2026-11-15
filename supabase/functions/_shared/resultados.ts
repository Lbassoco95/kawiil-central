// Marketing · Entrega 2 — resultados de Metricool: SIMULACRO (solo lectura, no escribe ningún dato).
// Lógica pura y sin dependencias (Deno y Node). Lee lo que devuelve el conector, lo reduce a números, fechas y códigos, lo empareja con las
// piezas del Calendario Maestro y arma el reporte de contraste que Dirección revisa ANTES de cargar nada (docs/marketing-entrega2-resultados.md §9).
//
// Reglas (Dirección): nunca se guarda ni se devuelve texto, título, hashtag, enlace, correo ni nombre de nadie; de cada publicación solo salen
// red, identificador, fecha, hora y métricas numéricas. La base solo se LEE. Los hallazgos del sondeo del 3 nov 2026 mandan:
//   · Instagram trae las horas en Europe/Madrid aunque se pidió Ciudad de México → se convierte con la zona que declara cada fecha.
//   · Facebook devuelve una lista y la fecha como número (época), no como objeto → se aceptan las dos formas.
//   · Facebook usa `impressionsUnique` como alcance (a validar contra el archivo); LinkedIn usa `impressions`.
//   · LinkedIn devolvió 0 elementos: si vuelve a pasar, se avisa y no se compara (no se inventa nada).

export const REDES = ["instagram", "facebook", "linkedin"] as const;
export type Red = (typeof REDES)[number];
export const ZONA = "America/Mexico_City";
export const UMBRAL_DIFERENCIA = 0.25; // diferencia mayor a 25 % entre el archivo y la API: dato a revisar

// ── Fechas y zonas horarias ─────────────────────────────────────────────────────────────────────────────────────────
function desfaseMs(instanteMs: number, zona: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(instanteMs)).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(instanteMs / 1000) * 1000;
}

/** Instante real de una hora local («2026-09-10T16:00:00») en una zona. null si el texto o la zona no sirven. Resuelve cambios de horario. */
export function instanteDe(local: string, zona: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!m) return null;
  try {
    const supuesto = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
    let t = supuesto - desfaseMs(supuesto, zona);
    t = supuesto - desfaseMs(t, zona); // segunda pasada: la primera puede caer del otro lado de un cambio de horario
    return Number.isFinite(t) ? new Date(t) : null;
  } catch { return null; }
}

/** Fecha («YYYY-MM-DD») y hora («HH:mm») en Ciudad de México de un instante. */
export function fechaHoraCDMX(d: Date): { fecha: string; hora: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ZONA, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** Lunes de la semana de una fecha («YYYY-MM-DD»), como `mk_semana_inicio`. */
export function semanaDe(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

export interface FechaLeida { instante: Date; zona: string }

/** Acepta {dateTime, timezone}, época en segundos o milisegundos, y texto ISO (sin zona = Ciudad de México). */
export function leerFecha(v: unknown): FechaLeida | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    return Number.isFinite(ms) ? { instante: new Date(ms), zona: "época" } : null;
  }
  if (typeof v === "string") {
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : { instante: d, zona: "con desfase" }; }
    const d = instanteDe(v, ZONA);
    return d ? { instante: d, zona: ZONA } : null;
  }
  if (v && typeof v === "object") {
    const o = v as { dateTime?: unknown; timezone?: unknown };
    if (typeof o.dateTime !== "string") return null;
    const zona = typeof o.timezone === "string" && /^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/.test(o.timezone) ? o.timezone : ZONA;
    const d = instanteDe(o.dateTime, zona);
    return d ? { instante: d, zona } : null;
  }
  return null;
}

const CAMPOS_FECHA = ["publishedAt", "publicationDate", "created", "timestamp", "creationDate"] as const;

// ── Lo que se conserva de cada publicación de la API ───────────────────────────────────────────────────────────────
export interface PubApi {
  red: Red; id: string | null; fecha: string; hora: string; minutos: number; zona: string;
  valor: number | null; guardados: number | null; compartidos: number | null; clics: number | null; reacciones: number | null; comentarios: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Qué campo de cada red es la medida del semáforo y cuáles son las demás (según los esquemas del swagger y el sondeo).
const CAMPOS: Record<Red, { valor: string; guardados?: string; compartidos: string; clics: string; reacciones: string; comentarios: string }> = {
  instagram: { valor: "reach", guardados: "saved", compartidos: "shares", clics: "clicks", reacciones: "likes", comentarios: "comments" },
  facebook: { valor: "impressionsUnique", compartidos: "shares", clics: "clicks", reacciones: "reactions", comentarios: "comments" },
  linkedin: { valor: "impressions", compartidos: "shares", clics: "clicks", reacciones: "likes", comentarios: "comments" },
};

/** La respuesta puede ser una lista (`$[]`, como Facebook) o `{ data: [...] }`. */
export function listaDe(datos: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(datos)) return datos as Array<Record<string, unknown>>;
  const d = (datos as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
}

/** Reduce la respuesta cruda a números, fecha y hora de Ciudad de México. Descarta todo lo demás (textos, enlaces, nombres…). */
export function extraerPublicaciones(red: Red, datos: unknown): PubApi[] {
  const c = CAMPOS[red], salida: PubApi[] = [];
  for (const p of listaDe(datos)) {
    let f: FechaLeida | null = null;
    for (const k of CAMPOS_FECHA) { f = leerFecha(p?.[k]); if (f) break; }
    if (!f) continue;
    const { fecha, hora } = fechaHoraCDMX(f.instante);
    const id = typeof p.postId === "string" || typeof p.postId === "number" ? String(p.postId).slice(0, 64) : null;
    salida.push({
      red, id, fecha, hora, minutos: Math.floor(f.instante.getTime() / 60000), zona: f.zona,
      valor: num(p[c.valor]), guardados: c.guardados ? num(p[c.guardados]) : null, compartidos: num(p[c.compartidos]), clics: num(p[c.clics]),
      reacciones: num(p[c.reacciones]), comentarios: num(p[c.comentarios]),
    });
  }
  return salida;
}

// ── Contraste archivo ↔ API ──────────────────────────────────────────────────────────────────────────────────────────
export interface PiezaArchivo { pieza_red_id: string; codigo: string; red: Red; publicada_at: string; valor: number | null }
export interface ReglaColor { verde_desde: number; amarillo_desde: number }
export type ColorSemaforo = "verde" | "amarillo" | "rojo" | "gris";

export const colorDe = (promedio: number | null, r: ReglaColor | null | undefined): ColorSemaforo =>
  promedio === null || !r ? "gris" : promedio >= r.verde_desde ? "verde" : promedio >= r.amarillo_desde ? "amarillo" : "rojo";

const media = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100;
};

export interface Diferencia { codigo: string; fecha: string; valor_archivo: number; valor_api: number; motivo: "api_menor_que_archivo" | "diferencia_mayor_a_25_pct" }
export interface FilaSemana {
  semana: string; piezas_archivo: number; piezas_api: number; emparejadas: number;
  promedio_archivo: number | null; promedio_api: number | null; diferencia_pct: number | null;
  color_archivo: ColorSemaforo; color_api: ColorSemaforo; colores_iguales: boolean; piezas_con_diferencia: number;
}
export interface ContrasteRed {
  red: Red; piezas_archivo: number; piezas_api: number; emparejadas: number;
  sin_pareja_archivo: Array<{ codigo: string; fecha: string }>; sin_pareja_api: Array<{ fecha: string; hora: string }>;
  semanas: FilaSemana[]; diferencias: Diferencia[];
  criterio_de_carga: { todas_emparejadas: boolean; colores_iguales: boolean; sin_diferencias_por_revisar: boolean; listo_para_cargar: boolean };
}

/** Empareja por red y fecha de Ciudad de México; con varias el mismo día, gana la hora más cercana (sin repetir ninguna). */
export function emparejar(archivo: PiezaArchivo[], api: PubApi[]): { pares: Array<{ a: PiezaArchivo; b: PubApi }>; sobraA: PiezaArchivo[]; sobraB: PubApi[] } {
  const info = archivo.map((a) => { const t = new Date(a.publicada_at); return { a, fecha: fechaHoraCDMX(t).fecha, minutos: Math.floor(t.getTime() / 60000) }; });
  const candidatos: Array<{ ia: number; ib: number; d: number }> = [];
  info.forEach((x, ia) => api.forEach((b, ib) => { if (x.fecha === b.fecha) candidatos.push({ ia, ib, d: Math.abs(x.minutos - b.minutos) }); }));
  candidatos.sort((p, q) => p.d - q.d || p.ia - q.ia || p.ib - q.ib);
  const usadoA = new Set<number>(), usadoB = new Set<number>(), pares: Array<{ a: PiezaArchivo; b: PubApi }> = [];
  for (const c of candidatos) {
    if (usadoA.has(c.ia) || usadoB.has(c.ib)) continue;
    usadoA.add(c.ia); usadoB.add(c.ib); pares.push({ a: info[c.ia].a, b: api[c.ib] });
  }
  return { pares, sobraA: archivo.filter((_, i) => !usadoA.has(i)), sobraB: api.filter((_, i) => !usadoB.has(i)) };
}

export function contrastarRed(red: Red, archivo: PiezaArchivo[], api: PubApi[], regla: ReglaColor | null): ContrasteRed {
  const { pares, sobraA, sobraB } = emparejar(archivo, api);
  const fechaA = (a: PiezaArchivo) => fechaHoraCDMX(new Date(a.publicada_at)).fecha;

  const diferencias: Diferencia[] = [];
  for (const { a, b } of pares) {
    if (a.valor === null || b.valor === null) continue;
    if (b.valor < a.valor) diferencias.push({ codigo: a.codigo, fecha: b.fecha, valor_archivo: a.valor, valor_api: b.valor, motivo: "api_menor_que_archivo" });
    else if (a.valor > 0 && Math.abs(b.valor - a.valor) / a.valor > UMBRAL_DIFERENCIA) diferencias.push({ codigo: a.codigo, fecha: b.fecha, valor_archivo: a.valor, valor_api: b.valor, motivo: "diferencia_mayor_a_25_pct" });
  }
  const conDif = new Set(diferencias.map((d) => d.codigo + "|" + d.fecha));

  const semanas = new Map<string, { A: PiezaArchivo[]; B: PubApi[]; pares: number; dif: number }>();
  const fila = (s: string) => semanas.get(s) ?? semanas.set(s, { A: [], B: [], pares: 0, dif: 0 }).get(s)!;
  for (const a of archivo) fila(semanaDe(fechaA(a))).A.push(a);
  for (const b of api) fila(semanaDe(b.fecha)).B.push(b);
  for (const { a, b } of pares) { const f = fila(semanaDe(b.fecha)); f.pares++; if (conDif.has(a.codigo + "|" + b.fecha)) f.dif++; }

  const filas: FilaSemana[] = [...semanas.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([semana, f]) => {
    const pa = media(f.A.map((x) => x.valor)), pb = media(f.B.map((x) => x.valor));
    const ca = colorDe(pa, regla), cb = colorDe(pb, regla);
    return {
      semana, piezas_archivo: f.A.length, piezas_api: f.B.length, emparejadas: f.pares, promedio_archivo: pa, promedio_api: pb,
      diferencia_pct: pa !== null && pb !== null && pa > 0 ? Math.round(((pb - pa) / pa) * 1000) / 10 : null,
      color_archivo: ca, color_api: cb, colores_iguales: ca === cb, piezas_con_diferencia: f.dif,
    };
  });

  const todas = sobraA.length === 0 && sobraB.length === 0;
  const coloresIguales = filas.every((f) => f.colores_iguales);
  const sinDif = diferencias.length === 0;
  return {
    red, piezas_archivo: archivo.length, piezas_api: api.length, emparejadas: pares.length,
    sin_pareja_archivo: sobraA.map((a) => ({ codigo: a.codigo, fecha: fechaA(a) })).sort((p, q) => p.fecha.localeCompare(q.fecha)),
    sin_pareja_api: sobraB.map((b) => ({ fecha: b.fecha, hora: b.hora })).sort((p, q) => (p.fecha + p.hora).localeCompare(q.fecha + q.hora)),
    semanas: filas, diferencias,
    criterio_de_carga: { todas_emparejadas: todas, colores_iguales: coloresIguales, sin_diferencias_por_revisar: sinDif, listo_para_cargar: archivo.length > 0 && api.length > 0 && todas && coloresIguales && sinDif },
  };
}

// ── Orquestación del simulacro (la base y el conector se inyectan: se prueba sin red) ─────────────────────────────────
export type LecturaRed = { ok: true; datos: unknown } | { ok: false; motivo: string };
export interface AlmacenSimulacro {
  piezasArchivo(desde: string, hasta: string): Promise<PiezaArchivo[]>;
  reglas(): Promise<Partial<Record<Red, ReglaColor>>>;
}
export interface FormatoFecha { nombre: string; entrada: (desde: string, hasta: string) => Record<string, string> }
const iso = (d: string, h: string) => `${d}T${h}`;
export const OPERACION: Record<Red, string> = { instagram: "instagram_posts", facebook: "facebook_posts", linkedin: "linkedin_posts" };
// Los parámetros de Facebook y LinkedIn no están documentados: se prueban los dos formatos vistos en el sondeo y se usa el primero que devuelva datos.
export const FORMATOS: Record<Red, FormatoFecha[]> = {
  instagram: [
    { nombre: "ISO con hora", entrada: (d, h) => ({ from: iso(d, "00:00:00"), to: iso(h, "23:59:59"), timezone: ZONA }) },
    { nombre: "solo fecha", entrada: (d, h) => ({ from: d, to: h, timezone: ZONA }) },
  ],
  facebook: [
    { nombre: "yyyyMMdd", entrada: (d, h) => ({ start: d.replaceAll("-", ""), end: h.replaceAll("-", ""), timezone: ZONA }) },
    { nombre: "ISO con hora", entrada: (d, h) => ({ start: iso(d, "00:00:00"), end: iso(h, "23:59:59"), timezone: ZONA }) },
  ],
  linkedin: [
    { nombre: "yyyyMMdd", entrada: (d, h) => ({ start: d.replaceAll("-", ""), end: h.replaceAll("-", ""), timezone: ZONA }) },
    { nombre: "ISO con hora", entrada: (d, h) => ({ start: iso(d, "00:00:00"), end: iso(h, "23:59:59"), timezone: ZONA }) },
  ],
};

export interface LecturaInforme { red: Red; ok: boolean; publicaciones: number; formato_fecha: string | null; intentos: Array<{ formato: string; ok: boolean; publicaciones: number; motivo?: string }>; zonas: Record<string, number>; }
export interface ReporteSimulacro {
  simulacro: true; escribe_datos: false; periodo: { desde: string; hasta: string }; generado_at: string;
  lecturas: LecturaInforme[]; redes: ContrasteRed[]; avisos: string[];
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export async function correrSimulacro(d: {
  desde: string; hasta: string; ahora?: Date; almacen: AlmacenSimulacro;
  leerMetricool: (red: Red, operacion: string, entrada: Record<string, string>) => Promise<LecturaRed>;
}): Promise<ReporteSimulacro> {
  if (!FECHA.test(d.desde) || !FECHA.test(d.hasta) || d.desde > d.hasta) throw new Error("periodo inválido");
  const avisos: string[] = [], lecturas: LecturaInforme[] = [], redes: ContrasteRed[] = [];
  const reglas = await d.almacen.reglas().catch(() => { avisos.push("No se pudieron leer las reglas del semáforo: los colores salen en gris."); return {} as Partial<Record<Red, ReglaColor>>; });
  const archivoTodo = await d.almacen.piezasArchivo(d.desde, d.hasta);

  for (const red of REDES) {
    const intentos: LecturaInforme["intentos"] = [];
    let api: PubApi[] = [], usado: string | null = null;
    for (const f of FORMATOS[red]) {
      const r = await d.leerMetricool(red, OPERACION[red], f.entrada(d.desde, d.hasta)).catch((e) => ({ ok: false as const, motivo: e instanceof Error ? e.message : "error" }));
      if (!r.ok) { intentos.push({ formato: f.nombre, ok: false, publicaciones: 0, motivo: r.motivo }); continue; }
      const pubs = extraerPublicaciones(red, r.datos);
      intentos.push({ formato: f.nombre, ok: true, publicaciones: pubs.length });
      if (pubs.length > 0) { api = pubs; usado = f.nombre; break; }
    }
    const zonas: Record<string, number> = {};
    for (const p of api) zonas[p.zona] = (zonas[p.zona] ?? 0) + 1;
    lecturas.push({ red, ok: api.length > 0, publicaciones: api.length, formato_fecha: usado, intentos, zonas });
    if (api.length === 0) avisos.push(`${red}: Metricool no devolvió publicaciones en el periodo (${intentos.map((i) => `${i.formato}: ${i.ok ? "0 elementos" : i.motivo}`).join("; ")}). No se compara esta red.`);
    const archivo = archivoTodo.filter((p) => p.red === red);
    // Una red sin lectura no se contrasta: compararla contra una lista vacía haría parecer que todo el archivo «no existe» en Metricool.
    if (api.length > 0) redes.push(contrastarRed(red, archivo, api.filter((p) => p.fecha >= d.desde && p.fecha <= d.hasta), reglas[red] ?? null));
  }
  return { simulacro: true, escribe_datos: false, periodo: { desde: d.desde, hasta: d.hasta }, generado_at: (d.ahora ?? new Date()).toISOString(), lecturas, redes, avisos };
}
