/**
 * Hash corto y estable de un texto, para usar como `context_key` de una
 * calificación de IA (dedupe por salida y por usuario). No es criptográfico.
 */
export function aiFeedbackKey(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
