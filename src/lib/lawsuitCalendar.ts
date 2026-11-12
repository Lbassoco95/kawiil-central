/** Eventos de Outlook para la audiencia y el plazo de un juicio (lógica pura, sin red). */

export type LawsuitEventKind = "audiencia" | "plazo";
export const LAWSUIT_EVENT_KINDS: LawsuitEventKind[] = ["audiencia", "plazo"];
export const LAWSUIT_EVENT_TZ = "America/Mexico_City";

export interface LawsuitEventSource {
  id: string;
  project_id: string;
  name: string;
  case_number?: string | null;
  court?: string | null;
  current_stage?: string | null;
  next_hearing_date?: string | null;
  next_hearing_time?: string | null;
  next_deadline_date?: string | null;
  next_deadline_note?: string | null;
}

export interface LawsuitEventSlot {
  date: string;
  time: string | null;
  note: string | null;
}

export interface EventAttendee {
  email: string;
  name?: string | null;
}

export interface LawsuitGraphEvent {
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  showAs: "busy" | "free";
  location?: { displayName: string };
  body: { contentType: "html"; content: string };
  attendees: { emailAddress: { address: string; name?: string }; type: "required" }[];
}

export function lawsuitEventSlot(l: LawsuitEventSource, kind: LawsuitEventKind): LawsuitEventSlot | null {
  if (kind === "audiencia") {
    if (!l.next_hearing_date) return null;
    const m = l.next_hearing_time?.match(/^(\d{1,2}):(\d{2})/);
    return {
      date: l.next_hearing_date,
      time: m ? `${m[1].padStart(2, "0")}:${m[2]}` : null,
      note: null,
    };
  }
  if (!l.next_deadline_date) return null;
  return { date: l.next_deadline_date, time: null, note: l.next_deadline_note?.trim() || null };
}

export function eventSlotChanged(
  prev: LawsuitEventSource | null | undefined,
  next: LawsuitEventSource,
  kind: LawsuitEventKind,
): boolean {
  const a = prev ? lawsuitEventSlot(prev, kind) : null;
  const b = lawsuitEventSlot(next, kind);
  return JSON.stringify(a) !== JSON.stringify(b) || (!!prev && prev.name !== next.name);
}

function shift(date: string, time: string, minutes: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi + minutes));
  return t.toISOString().slice(0, 19);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildLawsuitEvent(
  l: LawsuitEventSource,
  kind: LawsuitEventKind,
  opts: { projectName?: string | null; attendees: EventAttendee[]; appUrl?: string },
): LawsuitGraphEvent | null {
  const slot = lawsuitEventSlot(l, kind);
  if (!slot) return null;

  const allDay = !slot.time;
  const start = allDay ? `${slot.date}T00:00:00` : shift(slot.date, slot.time!, 0);
  const end = allDay ? shift(slot.date, "00:00", 24 * 60) : shift(slot.date, slot.time!, 60);

  const subject =
    kind === "audiencia"
      ? `⚖️ Audiencia: ${l.name}`
      : `⏰ Plazo: ${l.name}${slot.note ? ` — ${slot.note}` : ""}`;

  const lines: [string, string | null | undefined][] = [
    ["Proyecto", opts.projectName],
    ["Expediente", l.case_number],
    ["Juzgado / autoridad", l.court],
    ["Etapa actual", l.current_stage],
    ["Plazo", kind === "plazo" ? slot.note : null],
  ];
  const html = lines
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(String(v))}</p>`)
    .join("");
  const link = opts.appUrl
    ? `<p><a href="${esc(`${opts.appUrl}/proyectos/${l.project_id}?tab=juicios&lawsuitId=${l.id}`)}">Abrir en Kawiil</a></p>`
    : "";

  const seen = new Set<string>();
  const attendees = opts.attendees
    .map((a) => ({ ...a, email: a.email.trim().toLowerCase() }))
    .filter((a) => a.email && !seen.has(a.email) && seen.add(a.email))
    .map((a) => ({
      emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) },
      type: "required" as const,
    }));

  return {
    subject,
    start: { dateTime: start, timeZone: LAWSUIT_EVENT_TZ },
    end: { dateTime: end, timeZone: LAWSUIT_EVENT_TZ },
    isAllDay: allDay,
    showAs: kind === "plazo" ? "free" : "busy",
    ...(kind === "audiencia" && l.court?.trim() ? { location: { displayName: l.court.trim() } } : {}),
    body: { contentType: "html", content: html + link || "Juicio / trámite" },
    attendees,
  };
}
