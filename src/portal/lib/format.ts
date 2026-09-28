/** Formatos de México: fechas en hora del centro, pesos con dos decimales. */
const TZ = "America/Mexico_City";
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("es-MX", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d)) : "—";
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("es-MX", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "—";
export const fmtMoney = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === "" ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n));
export const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]?.slice(0, 3) ?? "?"} ${y}`;
};
