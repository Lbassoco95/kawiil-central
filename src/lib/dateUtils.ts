import { format as fnsFormat } from "date-fns";
import { es } from "date-fns/locale";

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
  const d = typeof date === "string" ? new Date(date) : date;
  // Create a date string in CDMX timezone and parse it back
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
export function formatDateMX(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-MX", { timeZone: CDMX_TZ });
}

/**
 * Retorna "ahora" en zona CDMX.
 */
export function nowMX(): Date {
  return toMXDate(new Date());
}
