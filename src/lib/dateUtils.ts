import { format as fnsFormat, parse } from "date-fns";
import { es } from "date-fns/locale";
import { fromZonedTime } from "date-fns-tz";

/**
 * Zona horaria central de México (CDMX).
 * Todas las fechas/horas en la UI deben mostrarse en esta zona.
 */
export const CDMX_TZ = "America/Mexico_City";

/**
 * Convierte una fecha (string ISO o Date) a un objeto Date ajustado a CDMX
 * para mostrar en pantalla. Usa Intl para obtener las partes correctas.
 */
export function toMXDate(date: string | Date): Date {
  // Date-only strings (YYYY-MM-DD) are parsed as UTC by JS,
  // which shifts them back a day in CDMX. Fix by parsing as local.
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, day] = date.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  const d = typeof date === "string" ? new Date(date) : date;
  const mxString = d.toLocaleString("en-US", { timeZone: CDMX_TZ });
  return new Date(mxString);
}

/**
 * Formatea una fecha usando date-fns con locale es, pero ajustada a zona CDMX.
 * Reemplaza todos los `format(new Date(x), pattern, { locale: es })` del proyecto.
 */
export function formatMX(date: string | Date, pattern: string): string {
  return fnsFormat(toMXDate(date), pattern, { locale: es });
}

/**
 * Formatea una fecha en formato corto localizado es-MX con zona CDMX.
 * Reemplaza todos los `new Date(x).toLocaleDateString("es-MX")`.
 */
export function formatDateMX(date: string | Date | null | undefined): string {
  if (date == null || (typeof date === "string" && date.trim() === "")) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { timeZone: CDMX_TZ });
}

/**
 * Retorna "ahora" en zona CDMX.
 */
export function nowMX(): Date {
  return toMXDate(new Date());
}

/**
 * Retorna la fecha actual en zona CDMX como string YYYY-MM-DD.
 * Usa para comparar contra columnas date en BD sin desfase UTC.
 */
export function toDateStringMX(date?: Date): string {
  const d = date ?? nowMX();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Slot horario CDMX para mood/frase del día.
 * Reglas (alineadas entre AiHeroGrid y MoodCheckin):
 *  - 09:00–14:59 → "morning" del día actual
 *  - 15:00–08:59 (día siguiente) → "afternoon"
 *      • antes de 09:00 cae en el "afternoon" del día anterior
 *        (último slot disponible para registrar / consultar)
 */
export function getMexicoTimeSlot(date?: Date): {
  timeOfDay: "morning" | "afternoon";
  checkDate: string;
} {
  const now = date ?? nowMX();
  const hour = now.getHours();
  if (hour >= 9 && hour < 15) {
    return { timeOfDay: "morning", checkDate: toDateStringMX(now) };
  }
  if (hour >= 15) {
    return { timeOfDay: "afternoon", checkDate: toDateStringMX(now) };
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return { timeOfDay: "afternoon", checkDate: toDateStringMX(yesterday) };
}

/**
 * Vencimiento por calendario en CDMX (compara solo día, evita desfaces UTC en ISO).
 */
export function isPastDueCalendarMX(due: string | null | undefined): boolean {
  if (due == null || String(due).trim() === "") return false;
  try {
    const dueYmd = toDateStringMX(toMXDate(due));
    const todayYmd = toDateStringMX(nowMX());
    return dueYmd < todayYmd;
  } catch {
    return false;
  }
}

/**
 * Inicio del día calendario `ymd` (YYYY-MM-DD) en CDMX y fin exclusivo del día siguiente, en ISO (UTC).
 * Para filtrar timestamptz en Supabase: .gte("col", start).lt("col", endExclusive).
 */
export function mexicoDayRangeISO(ymd: string): { start: string; endExclusive: string } {
  const start = fromZonedTime(parse(`${ymd} 00:00:00`, "yyyy-MM-dd HH:mm:ss", new Date(0)), CDMX_TZ);
  const [y, mo, da] = ymd.split("-").map(Number);
  const nextCal = new Date(y, mo - 1, da + 1);
  const nextYmd = `${nextCal.getFullYear()}-${String(nextCal.getMonth() + 1).padStart(2, "0")}-${String(nextCal.getDate()).padStart(2, "0")}`;
  const endExclusive = fromZonedTime(parse(`${nextYmd} 00:00:00`, "yyyy-MM-dd HH:mm:ss", new Date(0)), CDMX_TZ);
  return { start: start.toISOString(), endExclusive: endExclusive.toISOString() };
}

/** Suma días a una fecha calendario YYYY-MM-DD (componentes locales, coherente con toDateStringMX(nowMX)). */
export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toDateStringMX(dt);
}

/** Lunes de la semana (lun–dom) que contiene el día `ymd`. */
export function mondayYmdContaining(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + delta);
  return toDateStringMX(dt);
}

/**
 * Rango UTC [lunes 00:00 CDMX, lunes siguiente 00:00 CDMX) para la semana que contiene `ymd`.
 */
export function mexicoWeekRangeISOContaining(ymd: string): {
  start: string;
  endExclusive: string;
  weekLabel: string;
} {
  const mon = mondayYmdContaining(ymd);
  const { start } = mexicoDayRangeISO(mon);
  const nextMonYmd = addDaysToYmd(mon, 7);
  const endExclusive = mexicoDayRangeISO(nextMonYmd).start;
  const sunYmd = addDaysToYmd(mon, 6);
  const weekLabel = `${formatMX(mon, "d MMM")} – ${formatMX(sunYmd, "d MMM yyyy")}`;
  return { start, endExclusive, weekLabel };
}
