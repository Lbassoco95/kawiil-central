import { nowMX, toDateStringMX } from "@/lib/dateUtils";

/** Suma días hábiles (lun–vie), sin festivos. */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let added = 0;
  while (added < businessDays) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

export function defaultDueDatePlusThreeBusinessDays(): string {
  return toDateStringMX(addBusinessDays(nowMX(), 3));
}

const DOW_ES: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miércoles: 3,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sábado: 6,
  sabado: 6,
};

function nextNamedWeekday(targetDow: number, from: Date): Date {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (today.getDay() === targetDow) return today;
  const d = new Date(today);
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < 8; i++) {
    if (d.getDay() === targetDow) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

export type QuickTaskProfile = { user_id: string; full_name: string | null };

export function parseQuickTaskTitle(
  raw: string,
  opts: { profiles: QuickTaskProfile[]; defaultAssignedId?: string | null },
): { title: string; priority: string; due_date: string | null; assigned_to: string | null } {
  let text = raw.trim();
  let priority = "media";
  if (/#urgente\b/i.test(text)) priority = "urgente";
  else if (/#alta\b/i.test(text)) priority = "alta";
  else if (/#baja\b/i.test(text)) priority = "baja";
  text = text.replace(/#urgente\b|#alta\b|#baja\b/gi, " ").replace(/\s+/g, " ").trim();

  let assigned_to: string | null = opts.defaultAssignedId ?? null;
  const atRe = /@([^\s#@]+(?:\s+[^\s#@]+){0,2})/;
  const atMatch = text.match(atRe);
  if (atMatch) {
    const guess = atMatch[1].trim().toLowerCase();
    const found = opts.profiles.find((p) => (p.full_name || "").toLowerCase().includes(guess));
    if (found) assigned_to = found.user_id;
    text = text.replace(atMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  const today = nowMX();
  let due_date: string | null = null;
  const tLower = text.toLowerCase();
  if (/\bhoy\b/i.test(tLower)) {
    due_date = toDateStringMX(today);
    text = text.replace(/\bhoy\b/gi, " ").replace(/\s+/g, " ").trim();
  } else if (/\bmañana\b|\bmanana\b/i.test(tLower)) {
    const n = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    due_date = toDateStringMX(n);
    text = text.replace(/\bmañana\b|\bmanana\b/gi, " ").replace(/\s+/g, " ").trim();
  } else {
    for (const [word, dow] of Object.entries(DOW_ES)) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      if (re.test(tLower)) {
        due_date = toDateStringMX(nextNamedWeekday(dow, today));
        text = text.replace(re, " ").replace(/\s+/g, " ").trim();
        break;
      }
    }
  }

  return {
    title: text.trim() || raw.trim(),
    priority,
    due_date,
    assigned_to,
  };
}
