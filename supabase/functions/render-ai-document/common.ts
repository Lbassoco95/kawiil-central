import type { KawiilOutputFormat } from "../_shared/ai-templates/index.ts";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export function sanitizeFileName(input: string): string {
  const safe = String(input || "documento")
    .trim()
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  return safe || "documento";
}

export const FORMAT_EXT: Record<KawiilOutputFormat, string> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

export const FORMAT_MIME: Record<KawiilOutputFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Saneado de texto para pdfmake con fuentes built-in (Helvetica / WinAnsiEncoding).
 *
 * PDFKit (que usa pdfmake) lanza error al encontrar un carácter fuera del set
 * WinAnsi (Latin-1 + algunos codepoints mapeados en 0x80-0x9F). Los emojis,
 * CJK y símbolos matemáticos NO están soportados y rompen la generación del PDF.
 *
 * Aquí:
 *  - Mapeamos explícitamente los codepoints de WinAnsi extendido (€ — " ' …, etc.)
 *    que pdfkit sí soporta aunque su codepoint Unicode sea > 0xFF.
 *  - Los caracteres que no entran (emojis, CJK, iconos) los reemplazamos por "•"
 *    cuando aparecen al inicio de un bullet (para no dejar la línea vacía), o se
 *    eliminan silenciosamente en otros contextos.
 */
const WINANSI_EXTRA: Record<number, string> = {
  0x20AC: "\u20AC", 0x201A: "\u201A", 0x0192: "\u0192", 0x201E: "\u201E",
  0x2026: "\u2026", 0x2020: "\u2020", 0x2021: "\u2021", 0x02C6: "\u02C6",
  0x2030: "\u2030", 0x0160: "\u0160", 0x2039: "\u2039", 0x0152: "\u0152",
  0x017D: "\u017D", 0x2018: "\u2018", 0x2019: "\u2019", 0x201C: "\u201C",
  0x201D: "\u201D", 0x2022: "\u2022", 0x2013: "\u2013", 0x2014: "\u2014",
  0x02DC: "\u02DC", 0x2122: "\u2122", 0x0161: "\u0161", 0x203A: "\u203A",
  0x0153: "\u0153", 0x017E: "\u017E", 0x0178: "\u0178",
};

export function sanitizeForPdfText(text: string): string {
  if (!text) return text;
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0A || code === 0x0D) { out += ch; continue; }
    if (code < 0x20) continue;
    if (code <= 0xFF) { out += ch; continue; }
    if (WINANSI_EXTRA[code] !== undefined) { out += WINANSI_EXTRA[code]; continue; }
    // Fuera de WinAnsi (emojis, dingbats, CJK, flechas, etc.): lo removemos.
  }
  // Normaliza espacios dobles producidos por emojis removidos.
  return out.replace(/[ \t]{2,}/g, " ").trimEnd();
}

/**
 * Recorre recursivamente un objeto/arreglo y sanea todas las strings para que
 * sean renderizables por pdfmake con fuentes built-in. Devuelve una copia.
 */
// deno-lint-ignore no-explicit-any
export function deepSanitizeForPdf<T = any>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeForPdfText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepSanitizeForPdf(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepSanitizeForPdf(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Formatea un número como moneda (no usa Intl en edge para evitar issues). */
export function formatCurrency(value: number | undefined, currency = "MXN"): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const decimals = Math.round((abs - whole) * 100).toString().padStart(2, "0");
  const parts = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${parts}.${decimals} ${currency}`;
}

/** Formatea solo número con separadores. */
export function formatNumber(value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

/** Convierte preview_markdown; si no se pasa, lo arma a partir del template. */
export function buildPreviewMarkdown(
  title: string,
  templateKey: string,
  summary: string | undefined,
): string {
  const header = `# ${title}`;
  const tagline = `_Generado con template **${templateKey}** (Kawiil AI)._`;
  const body = summary ? `\n\n${summary}` : "";
  return `${header}\n\n${tagline}${body}`;
}
