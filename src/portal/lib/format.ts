/** Formatos de México: fechas en hora del centro, pesos con dos decimales. */
const TZ = "America/Mexico_City";
// Una fecha sin hora («2031-09-29») es un día del calendario: no se convierte de zona
// horaria (en México se vería un día antes).
export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const day = typeof d === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (day) return `${day[3]}/${day[2]}/${day[1]}`;
  return new Intl.DateTimeFormat("es-MX", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
};
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("es-MX", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "—";
export const fmtMoney = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === "" ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n));
/** UUID corto en listas; el detalle muestra el folio completo. */
export const fmtUuidShort = (uuid: string | null | undefined) => {
  if (!uuid) return "—";
  const u = String(uuid).trim();
  if (u.length <= 13) return u;
  return `${u.slice(0, 8)}…`;
};
export const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]?.slice(0, 3) ?? "?"} ${y}`;
};
