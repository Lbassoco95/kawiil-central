/**
 * Tokens visuales compartidos para superficies de Kawiil AI (v2.4).
 *
 * Usar estos valores en cualquier card, banner, dialog o botón que
 * represente una acción/resultado de la IA Kawiil, para mantener
 * el branding azul consistente a lo largo de toda la aplicación.
 *
 * Orden de importancia:
 *  1. `KAWIIL_AI_GRADIENT` → Fondos de bloques "hero" de IA (avatares,
 *     encabezados de dialog, iconos de sección). Inline-style `background`.
 *  2. `KAWIIL_AI_HEADER_BG` → Igual, alias semántico para headers de
 *     dialogs y tarjetas que llevan el icono de IA.
 *  3. `KAWIIL_AI_SOFT_BG` → Fondos suaves (banners, chips activos),
 *     en modo claro y oscuro.
 *
 *  Si necesitas tints Tailwind (`bg-blue-500/10`, `text-blue-700`, etc.)
 *  se considera compatible con este esquema, pues todo el sistema
 *  v2.4 apunta al mismo hue de azul Kawiil.
 */
export const KAWIIL_AI_GRADIENT =
  "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 55%))";

export const KAWIIL_AI_HEADER_BG = KAWIIL_AI_GRADIENT;

export const KAWIIL_AI_SOFT_BG =
  "linear-gradient(135deg, hsl(210 100% 47% / 0.08), hsl(220 100% 55% / 0.05) 60%, transparent)";

/** Clase Tailwind útil para textos con gradiente azul Kawiil. */
export const KAWIIL_AI_TEXT_GRADIENT_CLASS =
  "bg-gradient-to-r from-sky-500 to-blue-600 bg-clip-text text-transparent";
