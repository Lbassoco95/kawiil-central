// Avisos internos para el equipo («ese día no se trabaja»): validación, vigencia y el pedido al modelo que redacta el borrador.
// Funciones puras: no leen ni escriben nada. Las usa la función comunicacion-interna y, para la vigencia, la pantalla.
import { pareceSecreto, AVISO_SECRETO } from "./agenteConstructor.ts";

export const AGENTE_COMUNICACION = "marketing_comunicacion_interna";
export const TIPOS_AVISO = ["dia_inhabil", "general"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];
export const MAX_DIAS_AVISO = 31;
export interface AvisoEntrada { tipo: TipoAviso; titulo: string; mensaje: string; desde: string; hasta: string }
export interface AvisoVigente { id: string; tipo: TipoAviso; titulo: string; mensaje: string; desde: string; hasta: string }

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (s: unknown): s is string => typeof s === "string" && FECHA.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const dias = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
const limpio = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Fecha de hoy (AAAA-MM-DD) en Ciudad de México. */
export const hoyEnMexico = (d: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** ¿Se ve hoy? Publicado y hoy entre desde y hasta (incluyendo ambos días). */
export const vigente = (a: { desde: string; hasta: string; estado?: string }, hoy: string): boolean => (a.estado === undefined || a.estado === "publicado") && a.desde <= hoy && hoy <= a.hasta;

export function validarAviso(raw: unknown, hoy: string): { ok: true; aviso: AvisoEntrada } | { ok: false; errores: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errores: ["El aviso no tiene forma de objeto."] };
  const r = raw as Record<string, unknown>, errores: string[] = [];
  const tipo = (TIPOS_AVISO as readonly unknown[]).includes(r.tipo) ? (r.tipo as TipoAviso) : null;
  if (!tipo) errores.push("El tipo del aviso debe ser «día sin trabajo» o «general».");
  const titulo = limpio(r.titulo, 120), mensaje = limpio(r.mensaje, 600);
  if (titulo.length < 3) errores.push("Escribe un título de al menos 3 caracteres.");
  if (mensaje.length < 3) errores.push("Escribe el mensaje del aviso.");
  if (pareceSecreto(`${titulo} ${mensaje}`)) errores.push(AVISO_SECRETO);
  if (!diaValido(r.desde) || !diaValido(r.hasta)) errores.push("Las fechas deben tener el formato AAAA-MM-DD y existir.");
  else {
    if (r.hasta < r.desde) errores.push("La fecha final no puede ser anterior a la inicial.");
    else if (dias(r.desde, r.hasta) > MAX_DIAS_AVISO) errores.push(`Un aviso dura como máximo ${MAX_DIAS_AVISO} días.`);
    if (r.hasta < hoy) errores.push("El aviso ya terminó: la fecha final es anterior a hoy.");
  }
  return errores.length ? { ok: false, errores } : { ok: true, aviso: { tipo: tipo!, titulo, mensaje, desde: r.desde as string, hasta: r.hasta as string } };
}

// ── Redacción con el modelo: solo propone; no escribe nada ───────────────────────────────────────────────────────────
export const HERRAMIENTA_AVISO = {
  name: "proponer_aviso",
  description: "Propone el aviso interno para el equipo con sus fechas exactas. No lo publica: una persona lo revisa y lo aprueba.",
  input_schema: {
    type: "object",
    properties: {
      tipo: { type: "string", enum: [...TIPOS_AVISO], description: "dia_inhabil si se trata de un día sin trabajo; general en otro caso." },
      titulo: { type: "string", description: "Título corto (máximo 120 caracteres)." },
      mensaje: { type: "string", description: "Mensaje claro y cordial para el equipo, en español de México (máximo 600 caracteres)." },
      desde: { type: "string", description: "Primer día en que se ve el aviso, AAAA-MM-DD." },
      hasta: { type: "string", description: "Último día en que se ve el aviso, AAAA-MM-DD." },
    },
    required: ["tipo", "titulo", "mensaje", "desde", "hasta"],
  },
} as const;

export const systemRedactor = (hoy: string): string =>
  `Eres «Comunicación interna», el agente que redacta los comunicados internos para el equipo de Kawiil (un despacho profesional en México). Hoy es ${hoy} (hora de Ciudad de México).
Recibes una instrucción de Dirección y propones UN aviso con la herramienta proponer_aviso.
Reglas:
- Español de México, tono cordial, claro y breve. Sin emojis ni signos de exclamación en exceso.
- Convierte las fechas relativas a fechas exactas con el año correcto («el lunes 16» es el lunes 16 más próximo a hoy; si no se puede saber con certeza, usa la más cercana a partir de hoy). Un día sin trabajo dura solo ese día: desde y hasta son la misma fecha, salvo que la instrucción diga otro periodo.
- El aviso se ve en pantalla cuando alguien entra al sistema esos días. Escríbelo para quien lo lea ESE día (por ejemplo: «Hoy no se trabaja…»), indicando el día de la semana y la fecha, y cuándo se retoma el trabajo si la instrucción lo dice.
- No inventes datos que no estén en la instrucción (motivos, horarios, nombres). Si falta algo importante, redáctalo sin ese dato.
- Nunca incluyas contraseñas, claves, datos de clientes ni información confidencial.
- Tú solo propones: una persona de Dirección aprueba antes de que se publique.`;

/** El borrador que devuelve el modelo no es de fiar: se valida igual que lo que manda el navegador. */
export function borradorDeRespuesta(contenido: unknown, hoy: string): ReturnType<typeof validarAviso> | null {
  const bloque = (Array.isArray(contenido) ? contenido : []).find((b) => b && typeof b === "object" && (b as { type?: unknown }).type === "tool_use" && (b as { name?: unknown }).name === HERRAMIENTA_AVISO.name) as { input?: unknown } | undefined;
  return bloque ? validarAviso(bloque.input, hoy) : null;
}
