/**
 * Horario de silencio de los avisos al celular (hora de Ciudad de México).
 * Lógica pura de la tarjeta de Notificaciones; la regla que decide si se manda o no el push vive en
 * supabase/functions/_shared/horarioSilencio.ts.
 */

export const SILENCIO_INICIO_POR_DEFECTO = "22:00";
export const SILENCIO_FIN_POR_DEFECTO = "07:00";

/** «22:00:00» → «22:00». Si no es una hora válida devuelve null. */
export function normalizarHora(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(valor.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** «22:00» → «10:00 pm»; «07:30» → «7:30 am». */
export function horaAmigable(hhmm: string): string {
  const n = normalizarHora(hhmm);
  if (!n) return hhmm;
  const [h, m] = n.split(":").map(Number);
  const sufijo = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

/** Texto corto del horario: «De 10:00 pm a 7:00 am». */
export function describirHorario(inicio: string, fin: string): string {
  return `De ${horaAmigable(inicio)} a ${horaAmigable(fin)}`;
}

/** Resultado de validar: con `ok` verdadero vienen `inicio` y `fin` normalizados; si no, `motivo` explica por qué. */
export type ValidacionHorario = { ok: boolean; inicio: string; fin: string; motivo: string };

/** Revisa que ambas horas sean válidas y distintas (si fueran iguales no habría silencio). */
export function validarHorario(inicio: string, fin: string): ValidacionHorario {
  const i = normalizarHora(inicio);
  const f = normalizarHora(fin);
  if (!i || !f) return { ok: false, inicio: "", fin: "", motivo: "Elige una hora válida." };
  if (i === f) {
    return { ok: false, inicio: "", fin: "", motivo: "La hora de inicio y la de fin no pueden ser la misma." };
  }
  return { ok: true, inicio: i, fin: f, motivo: "" };
}
