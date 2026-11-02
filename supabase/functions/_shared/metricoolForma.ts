// Modo «forma» del conector de Metricool: reduce una respuesta a estructura (campos y tipos) y a una lista corta
// de números y enumeraciones permitidos. El cuerpo completo SOLO existe en la memoria de la función: lo que sale es lo
// que este módulo devuelve, y todo lo que devuelve pasa por filtros estrictos. Sin dependencias (Deno y Node).
//
// Qué sale:  rutas de campos y tipos · largo de listas · estadísticas de métricas numéricas de una lista blanca ·
//            conteos de valores de campos-enumeración de una lista blanca (solo si parecen códigos) · fechas (solo día
//            y semana, nunca la hora ni texto) · para respuestas que no son JSON, solo número de líneas y columnas.
// Qué NO sale nunca: textos, títulos, hashtags, enlaces, nombres, correos ni ningún valor de texto libre.

export const NUMEROS_PERMITIDOS: readonly string[] = [
  "reach", "saved", "shares", "likes", "comments", "clicks", "impressions", "impressionsTotal", "impressionsUnique",
  "impressionsOrganic", "uniqueImpressions", "engagement", "interactions", "follows", "views", "videoViews", "reactions",
];
export const ENUMS_PERMITIDOS: readonly string[] = ["network", "status", "detailedStatus", "type", "timezone"];
export const FECHAS_PADRES: readonly string[] = ["publicationDate", "publishedAt", "created", "creationDate"];

const CLAVE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;          // nombre de campo razonable (sin espacios, @, :, /, #)
const CODIGO = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;          // valor de enumeración: parece un código, no una frase
const ZONA = /^[A-Za-z_]+\/[A-Za-z_]+$/;                 // America/Mexico_City
const FECHA = /^(\d{4})-(\d{2})-(\d{2})T/;               // solo se usa el día
const MAX_RUTAS = 400, MAX_PROFUNDIDAD = 10, MAX_CLAVES_OBJETO = 60, MAX_VALORES_ENUM = 20, MAX_CABECERAS = 60;

type Tipo = "string" | "number" | "boolean" | "null" | "object" | "array";
const tipoDe = (v: unknown): Tipo => (v === null ? "null" : Array.isArray(v) ? "array" : (typeof v as Tipo));

export interface EstadisticaNumerica { n: number; ceros: number; min: number; mediana: number; media: number; max: number }
export interface Forma {
  tipo: "json" | "texto";
  elementos_lista: number | null;
  campos: Array<{ ruta: string; tipos: Partial<Record<Tipo, number>> }>;
  numeros: Record<string, EstadisticaNumerica>;
  conteos: Record<string, Record<string, number>>;
  fechas: Record<string, { n: number; desde: string; hasta: string; por_semana: Record<string, number> }>;
  claves_omitidas: number;
  truncado: boolean;
  // solo para respuestas que no son JSON
  lineas?: number; columnas?: number | null; cabeceras?: string[] | null;
}

function lunesDe(dia: string): string {
  const d = new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function resumirForma(datos: unknown): Forma {
  const f: Forma = { tipo: "json", elementos_lista: null, campos: [], numeros: {}, conteos: {}, fechas: {}, claves_omitidas: 0, truncado: false };
  const tipos = new Map<string, Partial<Record<Tipo, number>>>();
  const nums = new Map<string, number[]>();
  const enums = new Map<string, Map<string, number>>();
  const fechas = new Map<string, string[]>();

  const marcar = (ruta: string, t: Tipo) => {
    if (!tipos.has(ruta)) { if (tipos.size >= MAX_RUTAS) { f.truncado = true; return false; } tipos.set(ruta, {}); }
    const o = tipos.get(ruta)!; o[t] = (o[t] ?? 0) + 1; return true;
  };

  const caminar = (v: unknown, ruta: string, clave: string, padre: string, prof: number) => {
    const t = tipoDe(v);
    if (!marcar(ruta, t)) return;
    if (prof >= MAX_PROFUNDIDAD) { f.truncado = true; return; }
    if (t === "array") {
      for (const e of v as unknown[]) caminar(e, ruta + "[]", clave, padre, prof + 1);
    } else if (t === "object") {
      const entradas = Object.entries(v as Record<string, unknown>);
      if (entradas.length > MAX_CLAVES_OBJETO) { f.claves_omitidas += entradas.length; return; } // parece un diccionario de datos: no se recorre
      for (const [k, x] of entradas) {
        if (!CLAVE.test(k)) { f.claves_omitidas++; continue; }  // una clave con forma de dato (espacios, @, #, :) nunca sale
        caminar(x, `${ruta}.${k}`, k, clave, prof + 1);
      }
    } else if (t === "number") {
      if (NUMEROS_PERMITIDOS.includes(clave) && Number.isFinite(v as number)) (nums.get(ruta) ?? nums.set(ruta, []).get(ruta)!).push(v as number);
    } else if (t === "string") {
      const s = v as string;
      if (clave === "dateTime" && FECHAS_PADRES.includes(padre) && FECHA.test(s)) {
        (fechas.get(ruta) ?? fechas.set(ruta, []).get(ruta)!).push(s.slice(0, 10));
      } else if (ENUMS_PERMITIDOS.includes(clave)) {
        const m = enums.get(ruta) ?? enums.set(ruta, new Map()).get(ruta)!;
        const ok = clave === "timezone" ? ZONA.test(s) : CODIGO.test(s);
        const llave = ok ? s : "(otro: no es un código)";
        if (m.has(llave) || m.size < MAX_VALORES_ENUM) m.set(llave, (m.get(llave) ?? 0) + 1); else m.set("(otros)", (m.get("(otros)") ?? 0) + 1);
      }
      // cualquier otro texto: solo se cuenta su tipo (ya contado arriba); su valor se descarta
    }
  };

  if (datos === null || typeof datos !== "object") {
    // JSON que no es objeto ni lista (o texto ya procesado fuera de aquí): solo el tipo
    marcar("$", tipoDe(datos));
  } else {
    caminar(datos, "$", "$", "$", 0);
    const lista = !Array.isArray(datos) ? (datos as Record<string, unknown>).data : datos;
    f.elementos_lista = Array.isArray(lista) ? lista.length : null;
  }

  f.campos = [...tipos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ruta, t]) => ({ ruta, tipos: t }));
  for (const [ruta, xs] of nums) {
    f.numeros[ruta] = {
      n: xs.length, ceros: xs.filter((x) => x === 0).length, min: Math.min(...xs), mediana: mediana(xs),
      media: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100, max: Math.max(...xs),
    };
  }
  for (const [ruta, m] of enums) f.conteos[ruta] = Object.fromEntries([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  for (const [ruta, dias] of fechas) {
    const sorted = [...dias].sort(); const por: Record<string, number> = {};
    for (const d of dias) { const l = lunesDe(d); por[l] = (por[l] ?? 0) + 1; }
    f.fechas[ruta] = { n: dias.length, desde: sorted[0], hasta: sorted[sorted.length - 1], por_semana: Object.fromEntries(Object.entries(por).sort()) };
  }
  return f;
}

// Respuestas que no son JSON (CSV u otro texto): solo líneas, columnas y, si parecen nombres de campo, las cabeceras.
export function resumirTexto(texto: string): Forma {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  const cab = (lineas[0] ?? "").split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  const validas = cab.length > 0 && cab.length <= MAX_CABECERAS && cab.every((c) => /^[A-Za-z][A-Za-z0-9_ ./-]{0,40}$/.test(c));
  return {
    tipo: "texto", elementos_lista: null, campos: [], numeros: {}, conteos: {}, fechas: {}, claves_omitidas: 0, truncado: false,
    lineas: lineas.length, columnas: cab.length > 1 ? cab.length : null, cabeceras: validas && cab.length > 1 ? cab : null,
  };
}

export interface Salida { ok: boolean; estado: number; motivo: string; modo?: "forma"; datos?: unknown; forma?: Forma }

// Construye lo que el conector devuelve. En modo forma NUNCA incluye `datos`: el cuerpo completo no sale de aquí.
export function armarSalida(a: { forma: boolean; ok: boolean; estado: number; motivo: string; texto: string }): Salida {
  let datos: unknown = a.texto;
  let esJson = false;
  try { datos = JSON.parse(a.texto); esJson = true; } catch { /* CSV u otro texto */ }
  if (!a.forma) return { ok: a.ok, estado: a.estado, motivo: a.motivo, datos: a.ok ? datos : null };
  if (!a.ok) return { ok: false, estado: a.estado, motivo: a.motivo, modo: "forma" };
  return { ok: true, estado: a.estado, motivo: a.motivo, modo: "forma", forma: esJson ? resumirForma(datos) : resumirTexto(a.texto) };
}
