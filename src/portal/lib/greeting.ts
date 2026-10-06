/** Saludo y fecha en zona México (America/Mexico_City). */

const TZ = "America/Mexico_City";

export type DayPart = {
  greeting: "Buenos días" | "Buenas tardes" | "Buenas noches";
  emoji: string;
  hour: number;
};

/** Hora 0–23 en Ciudad de México. */
export function mexicoHour(now = new Date()): number {
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = Number(raw);
  return Number.isFinite(hour) ? hour % 24 : now.getHours();
}

/** Buenos días 05–11 · Buenas tardes 12–19 · Buenas noches 20–04. */
export function dayPart(now = new Date()): DayPart {
  const hour = mexicoHour(now);
  if (hour >= 5 && hour < 12) return { greeting: "Buenos días", emoji: "☀️", hour };
  if (hour >= 12 && hour < 20) return { greeting: "Buenas tardes", emoji: "🌤️", hour };
  return { greeting: "Buenas noches", emoji: "🌙", hour };
}

/** Fecha larga para el header, p. ej. «martes 6 de octubre de 2026». */
export function mexicoDateLabel(now = new Date()): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

/** Nombre corto para «Hola! {nombre}». */
export function displayFirstName(fullName: string | null | undefined, email?: string | null): string {
  const raw = String(fullName ?? "").trim();
  if (raw) {
    const beforeSep = raw.split(/\s*[·|]\s*/)[0]?.trim() ?? raw;
    return beforeSep || raw;
  }
  const local = String(email ?? "").split("@")[0]?.trim();
  if (local) return local.replace(/[._]+/g, " ");
  return "usuario";
}
