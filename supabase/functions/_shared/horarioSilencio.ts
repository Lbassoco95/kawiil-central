// Horario de silencio de los avisos push (por defecto 22:00 a 07:00, hora de Ciudad de México).
// Lógica pura: sin red ni base de datos. La usa sendWebPushToUsers (_shared/webPush.ts).

export const ZONA_HORARIA_AVISOS = "America/Mexico_City";
export const SILENCIO_INICIO_POR_DEFECTO = "22:00";
export const SILENCIO_FIN_POR_DEFECTO = "07:00";

export type HorarioSilencio = {
  /** null/undefined se toma como activado (es el valor por defecto de la columna). */
  enabled?: boolean | null;
  start?: string | null;
  end?: string | null;
};

/** «22:00» o «22:00:00» → minutos desde medianoche. null si no es una hora válida. */
export function minutosDesdeMedianoche(hora: string | null | undefined): number | null {
  if (typeof hora !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hora.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutos desde medianoche, en la zona de los avisos, del instante dado. */
export function minutosEnZona(ahora: Date, zona: string = ZONA_HORARIA_AVISOS): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0);
  const min = Number(partes.find((p) => p.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + min;
}

/**
 * ¿Ahora cae dentro del horario de silencio? Admite ventanas que cruzan la medianoche (22:00 → 07:00).
 * Fin exclusivo: a las 07:00 en punto ya se puede avisar. Si el horario es inválido o vacío, no silencia.
 */
export function enHorarioDeSilencio(ahora: Date, h: HorarioSilencio, zona: string = ZONA_HORARIA_AVISOS): boolean {
  if (h.enabled === false) return false;
  const inicio = minutosDesdeMedianoche(h.start ?? SILENCIO_INICIO_POR_DEFECTO);
  const fin = minutosDesdeMedianoche(h.end ?? SILENCIO_FIN_POR_DEFECTO);
  if (inicio === null || fin === null || inicio === fin) return false;
  const ahoraMin = minutosEnZona(ahora, zona);
  return inicio < fin ? ahoraMin >= inicio && ahoraMin < fin : ahoraMin >= inicio || ahoraMin < fin;
}
