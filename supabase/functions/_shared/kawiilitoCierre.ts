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

/** Desde este total se omite el desglose de vencidas: calma antes que alarma. */
const MUCHAS = 10;

/** null = no hay nada que cerrar: no se molesta al usuario. */
export function buildCierreMessage(i: CierreInput): { title: string; body: string } | null {
  if (i.dueNow <= 0 && i.agreements <= 0) return null;

  const sentences: string[] = [];
  if (i.dueNow > 0) {
    const one = i.dueNow === 1;
    let lead: string;
    if (i.dueNow >= MUCHAS || i.overdue <= 0) {
      lead = i.overdue <= 0 && i.dueNow < MUCHAS
        ? `Te ${one ? "queda" : "quedan"} ${plural(i.dueNow, "tarea", "tareas")} por cerrar hoy`
        : `Tienes ${plural(i.dueNow, "tarea", "tareas")} por cerrar`;
    } else if (i.overdue >= i.dueNow) {
      lead = `Tienes ${plural(i.dueNow, "tarea vencida", "tareas vencidas")} por cerrar`;
    } else {
      lead = `Tienes ${plural(i.dueNow, "tarea", "tareas")} por cerrar, ${i.overdue} de ellas ${i.overdue === 1 ? "vencida" : "vencidas"}`;
    }
    sentences.push(`${lead}: ciérra${one ? "la" : "las"} o mué${one ? "vela" : "velas"} a mañana.`);
  }
  if (i.agreements > 0) {
    const one = i.agreements === 1;
    sentences.push(
      `${plural(i.agreements, "compromiso", "compromisos")} de juntas ${one ? "sigue" : "siguen"} sin tarea.` +
        (i.dueNow <= 0 ? ` ${one ? "Conviértelo" : "Conviértelos"} en tarea cuando puedas.` : ""),
    );
  }

  const body = sentences.join(" ");
  return {
    title: "Kawiilito · Cierre del día",
    body: i.firstName ? `${i.firstName}, ${body.charAt(0).toLowerCase()}${body.slice(1)}` : body,
  };
}

export interface CierreOptions {
  /** Solo calcula y responde a quién avisaría; no crea notificaciones ni manda push. */
  dryRun: boolean;
  /** Limita el envío a una sola persona (pruebas). */
  onlyUserId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee las opciones opcionales del cuerpo de la petición; ignora lo que no entiende. */
export function parseCierreOptions(body: unknown): CierreOptions {
  const b = (body && typeof body === "object" ? body : {}) as { dry_run?: unknown; only_user_id?: unknown };
  const only = typeof b.only_user_id === "string" && UUID.test(b.only_user_id.trim()) ? b.only_user_id.trim() : null;
  return { dryRun: b.dry_run === true, onlyUserId: only };
}
