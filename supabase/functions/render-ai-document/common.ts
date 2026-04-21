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
