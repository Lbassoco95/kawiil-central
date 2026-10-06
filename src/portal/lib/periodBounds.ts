/** Límites de periodo (mes / semana / rango) en calendario México — fechas YYYY-MM-DD. */

export type PeriodKind = "mes" | "semana" | "rango";

export type PeriodBounds = {
  kind: PeriodKind;
  start: string;
  end: string;
  label: string;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** Mes calendario (1–12). */
export function monthBounds(year: number, month: number): PeriodBounds {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    kind: "mes",
    start: ymd(year, month, 1),
    end: ymd(year, month, last),
    label: `${MONTHS_ES[month - 1]} ${year}`,
  };
}

/** Semana que contiene `anchor` (lunes–domingo, ISO-ish local UTC date string). */
export function weekBounds(anchorYmd: string): PeriodBounds {
  const [ys, ms, ds] = anchorYmd.split("-").map(Number);
  const utc = new Date(Date.UTC(ys, ms - 1, ds));
  const day = utc.getUTCDay(); // 0=dom
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const start = ymd(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
  const end = ymd(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate());
  return {
    kind: "semana",
    start,
    end,
    label: `${start} → ${end}`,
  };
}

export function rangeBounds(start: string, end: string): PeriodBounds {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error("Fechas inválidas");
  }
  if (end < start) throw new Error("El fin debe ser ≥ inicio");
  return { kind: "rango", start, end, label: `${start} → ${end}` };
}

/** Hoy en zona México aproximada vía offset fijo no; usamos fecha UTC local del navegador formateada. */
export function todayYmd(d = new Date()): string {
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
