// Colchón de programación e informe de faltantes (Marketing). Funciones puras, sin dependencias:
// se usan tal cual en Deno (Edge Function marketing-colchon) y en Node (pruebas).
// Solo lectura: trabaja con lo que devuelve el conector de Metricool; no sabe escribir en Metricool.

export type Red = "instagram" | "facebook" | "linkedin";
export const REDES: readonly Red[] = ["instagram", "facebook", "linkedin"];
export const ZONA = "America/Mexico_City";

export type EstadoPub = "programada" | "publicada" | "con_error" | "desconocido";
export type Color = "verde" | "amarillo" | "rojo";

// Lo único que se conserva de cada publicación de Metricool: red, fecha, hora y estado.
export interface Publicacion { red: Red; fecha: string; hora: string; estado: EstadoPub; estado_original: string }
export interface Params { verde_desde: number; amarillo_desde: number; ventana_dias: number; tolerancia_min: number }
export const PARAMS_INICIALES: Params = { verde_desde: 14, amarillo_desde: 7, ventana_dias: 45, tolerancia_min: 30 };

export function hoyCDMX(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

export function fechaHoraCDMX(instante: string | Date): { fecha: string; hora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instante)).map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

const MS_DIA = 86_400_000;
const utc = (f: string) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
export const diasEntre = (desde: string, hasta: string): number => Math.round((utc(hasta) - utc(desde)) / MS_DIA);
export const sumarDias = (f: string, n: number): string => new Date(utc(f) + n * MS_DIA).toISOString().slice(0, 10);

// Solo PENDING sin borrador cuenta como programada. Lo que no se reconoce se marca "desconocido".
export function clasificarEstado(status: unknown, borrador: unknown): EstadoPub {
  if (borrador === true) return "desconocido";
  const s = String(status ?? "").toUpperCase();
  if (s === "PENDING") return "programada";
  if (s === "PUBLISHED") return "publicada";
  if (s.includes("ERROR")) return "con_error";
  return "desconocido";
}

// Reduce la respuesta cruda de /v2/scheduler/posts a red, fecha, hora y estado. Descarta el resto
// (textos, correos, enlaces): nada de eso se guarda ni se devuelve.
export function extraerPublicaciones(datos: unknown): Publicacion[] {
  const lista = (datos as { data?: unknown } | null)?.data;
  if (!Array.isArray(lista)) return [];
  const salida: Publicacion[] = [];
  for (const p of lista as Array<Record<string, unknown>>) {
    const pd = p?.publicationDate as { dateTime?: unknown; timezone?: unknown } | undefined;
    const dt = typeof pd?.dateTime === "string" ? pd.dateTime : "";
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(dt);
    if (!m) continue;
    const mismaZona = pd?.timezone === ZONA; // otra zona: no se adivina la conversión
    for (const e of (Array.isArray(p.providers) ? p.providers : []) as Array<Record<string, unknown>>) {
      const red = String(e?.network ?? "").toLowerCase();
      if (!(REDES as readonly string[]).includes(red)) continue;
      const original = String(e?.status ?? "");
      salida.push({
        red: red as Red, fecha: m[1], hora: m[2],
        estado: mismaZona ? clasificarEstado(original, p.draft) : "desconocido",
        estado_original: p.draft === true ? "DRAFT" : mismaZona ? original : `${original} (zona ${String(pd?.timezone ?? "?")})`,
      });
    }
  }
  return salida;
}

export function colorColchon(dias: number, p: Params): Color {
  return dias >= p.verde_desde ? "verde" : dias >= p.amarillo_desde ? "amarillo" : "rojo";
}

export interface ColchonRed { red: Red; ultima: string | null; dias: number; color: Color; tope: boolean; programadas: number }

// Colchón = días desde hoy (CDMX) hasta la última pieza programada de esa red. Sin piezas: 0 y rojo.
export function calcularColchon(pubs: Publicacion[], hoy: string, p: Params): ColchonRed[] {
  return REDES.map((red) => {
    const prog = pubs.filter((x) => x.red === red && x.estado === "programada" && x.fecha >= hoy);
    if (prog.length === 0) return { red, ultima: null, dias: 0, color: colorColchon(0, p), tope: false, programadas: 0 };
    const ultima = prog.map((x) => x.fecha).sort().at(-1)!;
    const crudo = diasEntre(hoy, ultima);
    const tope = crudo >= p.ventana_dias;
    const dias = tope ? p.ventana_dias : crudo;
    return { red, ultima, dias, color: colorColchon(dias, p), tope, programadas: prog.length };
  });
}

export interface PiezaEsperada { red: Red; fecha: string; hora: string; codigo: string; pilar: string | null; formato: string | null }
const minutos = (h: string) => +h.slice(0, 2) * 60 + +h.slice(3, 5);

// Una pieza del calendario está cubierta en una red si Metricool la tiene programada o ya publicada
// (misma fecha, hora dentro de la tolerancia). La fuente de verdad de lo programado es Metricool.
export function calcularFaltantes(esperadas: PiezaEsperada[], pubs: Publicacion[], tolMin: number): PiezaEsperada[] {
  return esperadas.filter((e) =>
    !pubs.some((x) => x.red === e.red && (x.estado === "programada" || x.estado === "publicada") && x.fecha === e.fecha
      && Math.abs(minutos(x.hora) - minutos(e.hora)) <= tolMin));
}

export interface FaltantePieza { fecha: string; hora: string; codigo: string; pilar: string | null; formato: string | null; redes: Red[] }

// Una línea por pieza (no una por pieza y red): la pieza lista las redes en las que falta.
export function agruparFaltantes(faltantes: PiezaEsperada[]): FaltantePieza[] {
  const por = new Map<string, FaltantePieza>();
  for (const f of faltantes) {
    const k = `${f.codigo}|${f.fecha}|${f.hora}`;
    const g = por.get(k) ?? { fecha: f.fecha, hora: f.hora, codigo: f.codigo, pilar: f.pilar, formato: f.formato, redes: [] };
    if (!g.redes.includes(f.red)) g.redes.push(f.red);
    por.set(k, g);
  }
  return [...por.values()].sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
}

export interface InformeEntrada {
  hoy: string; simulada: boolean; colchon: ColchonRed[]; pubs: Publicacion[]; esperadas: PiezaEsperada[]; p: Params; piezasEnVentana: number;
}

export function armarInforme(i: InformeEntrada) {
  const faltantes = agruparFaltantes(calcularFaltantes(i.esperadas, i.pubs, i.p.tolerancia_min));
  const con_error = i.pubs.filter((x) => x.estado === "con_error").map(({ red, fecha, hora, estado_original }) => ({ red, fecha, hora, estado: estado_original }));
  const desconocidos = i.pubs.filter((x) => x.estado === "desconocido").map(({ red, fecha, hora, estado_original }) => ({ red, fecha, hora, estado: estado_original }));
  const necesita: string[] = [];
  if (i.piezasEnVentana === 0) necesita.push("El Calendario Maestro no tiene piezas cargadas en los próximos 14 días: cargar el calendario para poder comparar.");
  for (const c of i.colchon) {
    if (c.color !== "verde") necesita.push(`${c.red}: el colchón es de ${c.dias} días (${c.color}); programar piezas hasta cubrir ${i.p.verde_desde} días. Tener imagen y texto listos y revisados.`);
  }
  for (const f of faltantes) necesita.push(`Programar la pieza ${f.codigo} del ${f.fecha} a las ${f.hora}${f.pilar ? `, pilar ${f.pilar}` : ""}${f.formato ? `, formato ${f.formato}` : ""}, en ${f.redes.join(", ")}. Confirmar imagen y texto listos.`);
  for (const e of con_error) necesita.push(`${e.red}: la pieza del ${e.fecha} a las ${e.hora} tiene error en Metricool; revisar el motivo y reprogramar desde Metricool (el módulo no edita).`);
  for (const d of desconocidos) necesita.push(`${d.red}: la pieza del ${d.fecha} a las ${d.hora} tiene un estado que el módulo no reconoce (${d.estado}); revisarla en Metricool.`);
  return {
    fecha: i.hoy, simulada: i.simulada, ventana_dias: 14,
    colchon: i.colchon.map(({ red, dias, color, ultima, tope }) => ({ red, dias, color, ultima, tope })),
    faltantes, con_error, desconocidos, piezas_calendario_en_ventana: i.piezasEnVentana, necesita_direccion: necesita,
  };
}

// Un solo caso abierto por red mientras el colchón siga bajo la meta: se abre si no hay, se actualiza si ya existe
// y se cierra cuando el colchón se recupera (14 días o más). Nunca se abre un segundo caso.
export interface CasoAbierto { id: string; numero: number; evidencia?: { dias?: number; ultima_programada?: string | null; fallas?: string[] } | null }
export type AccionCaso =
  | { accion: "abrir" }
  | { accion: "actualizar"; id: string; numero: number; dias_anterior: number | null; cambio: boolean }
  | { accion: "cerrar"; id: string; numero: number; dias_anterior: number | null }
  | { accion: "nada" };

export function decidirCaso(c: ColchonRed, p: Params, abierto: CasoAbierto | undefined): AccionCaso {
  const bajo = c.dias < p.verde_desde;
  if (!abierto) return bajo ? { accion: "abrir" } : { accion: "nada" };
  const dias_anterior = typeof abierto.evidencia?.dias === "number" ? abierto.evidencia.dias : null;
  if (!bajo) return { accion: "cerrar", id: abierto.id, numero: abierto.numero, dias_anterior };
  const cambio = dias_anterior !== c.dias || (abierto.evidencia?.ultima_programada ?? null) !== c.ultima;
  return { accion: "actualizar", id: abierto.id, numero: abierto.numero, dias_anterior, cambio };
}
