/**
 * Kawiilito: el compañero de Kawiil AI que vigila el seguimiento del día.
 * Elige pose y mensaje a partir de datos que ya tiene el dashboard (sin llamadas a IA),
 * con el tono calmado de la dirección Zen + Glass.
 */

export type KawiilitoPose = "saluda" | "tareas" | "piensa" | "revisa" | "celebra";

export interface KawiilitoInput {
  firstName: string;
  /** "manana" antes de las 17:00 CDMX; "cierre" después. */
  phase: "manana" | "cierre";
  /** Pendientes totales del usuario. */
  tasksCount: number;
  /** Vencen hoy o ya vencieron (las que se pueden cerrar desde el briefing). */
  dueNow: number;
  overdueCount: number;
  completedToday: number;
  /** Compromisos de juntas recientes que aún no son tarea (tuyos + sin responsable). */
  agreementsPending: number;
  /** El briefing se está generando. */
  generating: boolean;
  /** Primera vez que abre el dashboard hoy. */
  firstVisitToday: boolean;
}

export interface KawiilitoState {
  pose: KawiilitoPose;
  line: string;
  /** Destino sugerido cuando el mensaje invita a actuar. */
  href?: string;
  /** Cambia cuando cambia el mensaje: sirve para volver a mostrarlo tras descartarlo. */
  key: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function kawiilitoState(i: KawiilitoInput): KawiilitoState {
  const make = (pose: KawiilitoPose, line: string, href?: string): KawiilitoState => ({
    pose,
    line,
    href,
    key: `${pose}:${line}`,
  });

  if (i.generating) return make("piensa", "Preparando tu briefing con calma…");

  if (i.firstVisitToday) {
    return make(
      "saluda",
      i.phase === "cierre"
        ? `Hola, ${i.firstName}. Voy a ayudarte a cerrar el día.`
        : `Buen día, ${i.firstName}. Me quedo pendiente de tus tareas.`,
    );
  }

  if (i.phase === "cierre") {
    if (i.dueNow > 0) {
      return make(
        "tareas",
        `Te ${i.dueNow === 1 ? "queda" : "quedan"} ${plural(i.dueNow, "tarea", "tareas")} del día: ciérrala o muévela a mañana.`,
      );
    }
    if (i.completedToday > 0 && i.agreementsPending === 0) {
      return make("celebra", `Día cerrado: ${plural(i.completedToday, "tarea completada", "tareas completadas")}. Buen trabajo.`);
    }
  }

  if (i.agreementsPending > 0) {
    return make(
      "piensa",
      `Hay ${plural(i.agreementsPending, "compromiso", "compromisos")} de juntas sin tarea. ¿Los revisamos?`,
      "/juntas",
    );
  }

  if (i.overdueCount > 0) {
    return make("revisa", `Tienes ${plural(i.overdueCount, "tarea vencida", "tareas vencidas")}; empezaría por la más antigua.`);
  }

  if (i.dueNow > 0) {
    return make("tareas", `Hoy ${i.dueNow === 1 ? "vence" : "vencen"} ${plural(i.dueNow, "tarea", "tareas")}. Vamos paso a paso.`);
  }

  if (i.completedToday > 0 && i.tasksCount === 0) {
    return make("celebra", "Todo al día. Aprovecha para adelantar algo de mañana.");
  }

  return make("revisa", "Todo en orden. Sigo pendiente por ti.");
}
