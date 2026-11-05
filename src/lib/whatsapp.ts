/**
 * Utilidades de WhatsApp (wa.me). Sin dependencias, para poder probarlas aparte.
 */

/**
 * Normaliza un teléfono a dígitos con lada de país para wa.me.
 * - 10 dígitos → se asume México (+52).
 * - "52" + 10 dígitos, "521" + 10 dígitos o "044/045" + 10 dígitos (formatos móviles antiguos) → 52 + 10 dígitos.
 * - Con "+" o "00" al inicio se respeta el país indicado.
 * Devuelve null si no parece un número válido (8 a 15 dígitos).
 */
export function normalizeWhatsappNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;

  if (!international) {
    if (digits.length === 10) return `52${digits}`;
    if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
    if (digits.length === 13 && (digits.startsWith("044") || digits.startsWith("045"))) {
      return `52${digits.slice(3)}`; // prefijo antiguo de celular
    }
    if (digits.length === 12 && digits.startsWith("52")) return digits;
    if (digits.length === 11 && digits.startsWith("1")) return digits; // NANP
    return digits.length >= 11 ? digits : null;
  }
  if (digits.startsWith("521") && digits.length === 13) return `52${digits.slice(3)}`;
  return digits;
}

/** Link para abrir un chat con el número (o el selector de contactos si no hay número). */
export function whatsappUrl(text: string, number?: string | null): string {
  const base = number ? `https://wa.me/${number}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** Primer nombre para el saludo ("Viridiana García" → "Viridiana"). */
export function firstName(full?: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Personaliza el saludo inicial del mensaje base: "¡Hola!" → "¡Hola Viri!". */
export function personalizeGreeting(text: string, name?: string | null): string {
  const n = firstName(name);
  return n ? text.replace("¡Hola!", `¡Hola ${n}!`) : text;
}
