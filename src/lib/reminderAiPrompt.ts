/** Mensaje inicial sugerido al abrir el asistente para crear recordatorios personales (herramienta create_reminder). */
export const REMINDER_AI_PROMPT_ES = `Quiero crear un recordatorio personal en Kawiil (mis recordatorios del dashboard).

Indica qué recordar, opcionalmente fecha límite (YYYY-MM-DD), hora (HH:MM) y detalle en texto. Si quieres avisos automáticos, elige cadencia con repeat_kind en la herramienta:
- "none" = solo en mi lista (sin avisos de resumen)
- "hourly_digest" = incluir en el resumen cada hora (si tengo activado el aviso horario en el dashboard)
- "daily_digest" = un aviso al día por la mañana

Cuando tengas título claro, usa create_reminder. Si falta algo, pregúntame una sola cosa a la vez.

Mi recordatorio:`;
