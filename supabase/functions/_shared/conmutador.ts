// Lógica pura y compartida del Conmutador (sin APIs de Deno).
// La consumen las Edge Functions sw-* y se prueba con vitest desde
// src/lib/conmutador.test.ts (importada por ruta relativa). Mantener este
// archivo libre de dependencias de runtime (no Deno.env, no fetch, etc.).

export const CELULAS = ["LIT", "CORP", "COMP", "CONT", "PROC"] as const;
export type Celula = (typeof CELULAS)[number];

export const CELULA_LABELS: Record<Celula, string> = {
  LIT: "Litigio",
  CORP: "Corporativo",
  COMP: "Compliance (PLD-FT)",
  CONT: "Contable/Fiscal",
  PROC: "Procesos internos",
};

// Descripción usada en el prompt de clasificación (Haiku).
export const CELULA_SCOPE: Record<Celula, string> = {
  LIT: "litigio, audiencias, amparos, detenciones",
  CORP: "sociedades, contratos, fusiones",
  COMP: "PLD-FT, KYC, regulación, auditorías",
  CONT: "SAT, IMSS, declaraciones, facturas, nómina",
  PROC: "procesos internos",
};

export type Urgencia = "urgent" | "medium" | "standard";
export type Ruta = "urgente" | "estandar";

export function isCelula(v: unknown): v is Celula {
  return typeof v === "string" && (CELULAS as readonly string[]).includes(v);
}

// 🔴/🟡/🟢 según el nivel de urgencia.
export function severityEmoji(u: Urgencia): string {
  return u === "urgent" ? "🔴" : u === "medium" ? "🟡" : "🟢";
}

export function rutaFromUrgencia(u: Urgencia): Ruta {
  return u === "urgent" ? "urgente" : "estandar";
}

export function urgenciaFromFlags(urgente: boolean): Urgencia {
  return urgente ? "urgent" : "standard";
}

// task_priority (enum de public.tasks): urgente | alta | media | baja.
export function taskPriorityFromUrgencia(u: Urgencia): "urgente" | "alta" | "media" | "baja" {
  return u === "urgent" ? "urgente" : u === "medium" ? "alta" : "media";
}

// ---------------------------------------------------------------------------
// Brief estructurado (texto) que se envía al G4 y se guarda en switchboard_call.
// El resumen del motivo (2–3 líneas) lo produce Claude Sonnet; el resto se arma
// de forma determinista.
// ---------------------------------------------------------------------------
export interface BriefParts {
  urgencia: Urgencia;
  folio: string;
  celula: Celula | null;
  llamante?: string | null;
  empresa?: string | null;
  telefono?: string | null;
  correo?: string | null;
  motivoResumen: string;
  transcriptUrl?: string | null;
  recordingUrl?: string | null;
  carteraEstado?: string | null; // 'al_dia' | 'vencido' | null
  transferenciaFallida?: boolean; // ruta urgente sin conexión en 15s
}

export function buildBriefText(p: BriefParts): string {
  const emoji = severityEmoji(p.urgencia);
  const celula = p.celula ? `${p.celula} · ${CELULA_LABELS[p.celula]}` : "Sin clasificar";
  const nivel =
    p.urgencia === "urgent" ? "URGENTE" : p.urgencia === "medium" ? "Media" : "Estándar";
  const contactoPartes = [p.telefono, p.correo].filter(Boolean);
  const contacto = contactoPartes.length ? contactoPartes.join(" · ") : "Sin datos de contacto";
  const quien = [p.llamante, p.empresa].filter(Boolean).join(" — ") || "Llamante no identificado";

  const lines: string[] = [];
  lines.push(`${emoji} ${nivel} · Folio ${p.folio}`);
  lines.push(`Célula: ${celula}`);
  lines.push(`Llamante: ${quien}`);
  lines.push(`Contacto: ${contacto}`);
  if (p.carteraEstado) {
    const cartera = p.carteraEstado === "vencido" ? "⚠️ Vencido" : "Al día";
    lines.push(`Cartera: ${cartera}`);
  }
  lines.push("");
  lines.push(`Motivo:\n${p.motivoResumen.trim()}`);
  if (p.transcriptUrl || p.recordingUrl) {
    lines.push("");
    if (p.transcriptUrl) lines.push(`Transcripción: ${p.transcriptUrl}`);
    if (p.recordingUrl) lines.push(`Grabación: ${p.recordingUrl}`);
  }
  if (p.transferenciaFallida) {
    lines.push("");
    lines.push("🔴 La transferencia urgente NO conectó en 15s. Devolver la llamada de inmediato.");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Folio KAW-AAAA-XXXX (el consecutivo lo genera la RPC atómica en Postgres;
// esta función solo formatea, y sirve para pruebas deterministas).
// ---------------------------------------------------------------------------
export function formatFolio(anio: number, consecutivo: number): string {
  return `KAW-${anio}-${String(consecutivo).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Urgencia — 4 criterios. Reglas por keywords (deterministas). La Edge Function
// combina esto con Claude Haiku para señales implícitas.
// ---------------------------------------------------------------------------
export type CriterioUrgencia =
  | "audiencia_48h"
  | "persona_detenida"
  | "requerimiento_autoridad"
  | "lenguaje_urgencia";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos
}

const KW_AUDIENCIA = ["audiencia", "diligencia", "comparecencia", "desahogo"];
// Señales de "en menos de 48h".
const KW_PRONTO = [
  "hoy",
  "manana",
  "pasado manana",
  "en dos dias",
  "en 2 dias",
  "48 horas",
  "cuarenta y ocho horas",
  "esta semana",
  "en unas horas",
];
const KW_DETENCION = [
  "detenido",
  "detenida",
  "detencion",
  "arrestado",
  "arrestada",
  "arresto",
  "custodia",
  "aprehendido",
  "aprehension",
  "privado de la libertad",
  "privada de la libertad",
  "en el ministerio publico",
];
const KW_DOC_AUTORIDAD = [
  "citatorio",
  "oficio",
  "notificacion",
  "requerimiento",
  "emplazamiento",
  "orden de",
];
const KW_AUTORIDAD = [
  "sat",
  "imss",
  "infonavit",
  "juez",
  "juzgado",
  "ministerio publico",
  "fiscalia",
  "autoridad",
  "tribunal",
];
const KW_URGENCIA = [
  "urgente",
  "urgencia",
  "emergencia",
  "inmediato",
  "inmediata",
  "ahora",
  "hoy mismo",
  "no puede esperar",
  "cuanto antes",
  "de inmediato",
  "ya mismo",
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// Devuelve los criterios de urgencia activados SOLO por keywords.
export function detectUrgencyCriteria(transcript: string): CriterioUrgencia[] {
  const t = normalize(transcript || "");
  const criterios: CriterioUrgencia[] = [];

  // (1) audiencia/diligencia/comparecencia en <48h
  if (includesAny(t, KW_AUDIENCIA) && includesAny(t, KW_PRONTO)) {
    criterios.push("audiencia_48h");
  }
  // (2) persona detenida/bajo custodia
  if (includesAny(t, KW_DETENCION)) {
    criterios.push("persona_detenida");
  }
  // (3) requerimiento de autoridad (documento + autoridad)
  if (includesAny(t, KW_DOC_AUTORIDAD) && includesAny(t, KW_AUTORIDAD)) {
    criterios.push("requerimiento_autoridad");
  }
  // (4) lenguaje de urgencia del llamante
  if (includesAny(t, KW_URGENCIA)) {
    criterios.push("lenguaje_urgencia");
  }

  return criterios;
}

// ---------------------------------------------------------------------------
// Prompts para Claude.
// ---------------------------------------------------------------------------
export function buildClassifyPrompt(motivo: string): { system: string; user: string } {
  const mapa = CELULAS.map((c) => `${c} = ${CELULA_SCOPE[c]}`).join("; ");
  const system =
    "Eres un clasificador del conmutador de un despacho legal-contable mexicano. " +
    "Dado el motivo de una llamada (texto corto), responde ÚNICAMENTE con un JSON " +
    "válido, sin texto adicional, con esta forma: " +
    '{"celula":"LIT|CORP|COMP|CONT|PROC","confidence":0-1,' +
    '"needs_disambiguation":bool,"pregunta_sugerida":string|null}. ' +
    `Mapa de células: ${mapa}. ` +
    "Si el motivo es ambiguo o insuficiente para elegir una sola célula con confianza, " +
    'pon needs_disambiguation=true y ofrece una "pregunta_sugerida" breve para desambiguar. ' +
    "Sé conciso; prioriza baja latencia.";
  const user = `Motivo del llamante: "${(motivo || "").trim()}"`;
  return { system, user };
}

export interface ClassifyResult {
  celula: Celula | null;
  confidence: number;
  needs_disambiguation: boolean;
  pregunta_sugerida: string | null;
}

// Parseo tolerante de la respuesta del modelo (puede venir con ```json).
export function parseClassifyResponse(raw: string): ClassifyResult {
  const fallback: ClassifyResult = {
    celula: null,
    confidence: 0,
    needs_disambiguation: true,
    pregunta_sugerida: "¿Podrías contarme un poco más sobre el motivo de tu llamada?",
  };
  if (!raw) return fallback;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const obj = JSON.parse(match[0]);
    const celula = isCelula(obj.celula) ? obj.celula : null;
    return {
      celula,
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
      needs_disambiguation: celula === null ? true : Boolean(obj.needs_disambiguation),
      pregunta_sugerida:
        typeof obj.pregunta_sugerida === "string" ? obj.pregunta_sugerida : null,
    };
  } catch {
    return fallback;
  }
}

// ¿El motivo (célula CONT) es de pago/cobranza? → dispara enlace a Finanzas.
const KW_PAGO_COBRANZA = [
  "pago",
  "pagar",
  "cobranza",
  "cobro",
  "factura",
  "facturacion",
  "adeudo",
  "deuda",
  "saldo",
  "vencido",
  "estado de cuenta",
  "honorarios",
];
export function esPagoOCobranza(motivo: string): boolean {
  return includesAny(normalize(motivo || ""), KW_PAGO_COBRANZA);
}
