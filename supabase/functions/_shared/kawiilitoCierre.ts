/**
 * Mensaje de cierre del día de Kawiilito (notificación de las 17:00 CDMX).
 * Puro y sin APIs de Deno para poder probarlo con vitest. Tono Zen: breve y sin alarma.
 */

export interface CierreInput {
  firstName: string;
  /** Tareas abiertas que vencen hoy o ya vencieron. */
  dueNow: number;
  /** De las anteriores, las que ya vencieron antes de hoy. */
  overdue: number;
  /** Compromisos de juntas recientes del usuario que aún no son tarea. */
  agreements: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** null = no hay nada que cerrar: no se molesta al usuario. */
export function buildCierreMessage(i: CierreInput): { title: string; body: string } | null {
  if (i.dueNow <= 0 && i.agreements <= 0) return null;

  const parts: string[] = [];
  if (i.dueNow > 0) {
    const overdue = i.overdue > 0 ? ` (${plural(i.overdue, "vencida", "vencidas")})` : "";
    parts.push(
      `Te ${i.dueNow === 1 ? "queda" : "quedan"} ${plural(i.dueNow, "tarea", "tareas")} del día${overdue}: ciérra${i.dueNow === 1 ? "la" : "las"} o mué${i.dueNow === 1 ? "vela" : "velas"} a mañana.`,
    );
  }
  if (i.agreements > 0) {
    parts.push(`${plural(i.agreements, "compromiso", "compromisos")} de juntas ${i.agreements === 1 ? "sigue" : "siguen"} sin tarea.`);
  }

  return {
    title: "Kawiilito · Cierre del día",
    body: `${i.firstName ? `${i.firstName}, ` : ""}${parts.join(" ")}`.replace(/^(\S+), (\S)/, (_m, n, c) => `${n}, ${c.toLowerCase()}`),
  };
}
