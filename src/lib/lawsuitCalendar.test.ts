import { describe, expect, it } from "vitest";
import { buildLawsuitEvent, eventSlotChanged, lawsuitEventSlot, type LawsuitEventSource } from "./lawsuitCalendar";

const base: LawsuitEventSource = {
  id: "l1",
  project_id: "p1",
  name: "Queja CONDUSEF",
  case_number: "2026/090/59187",
  court: "CONDUSEF",
  current_stage: "Informe de Banamex",
  next_hearing_date: "2026-10-29",
  next_hearing_time: "14:00:00",
  next_deadline_date: "2026-10-29",
  next_deadline_note: "Revisar cita",
};

describe("lawsuitEventSlot", () => {
  it("normaliza la hora de Postgres y omite la fecha vacía", () => {
    expect(lawsuitEventSlot(base, "audiencia")).toEqual({ date: "2026-10-29", time: "14:00", note: null });
    expect(lawsuitEventSlot({ ...base, next_deadline_date: null }, "plazo")).toBeNull();
  });
});

describe("buildLawsuitEvent", () => {
  it("audiencia con hora: evento de 1 h en CDMX con juzgado como lugar", () => {
    const ev = buildLawsuitEvent(base, "audiencia", {
      projectName: "Leopoldo Bassoco",
      attendees: [{ email: "A@kawiil.mx", name: "Ana" }, { email: "a@kawiil.mx" }, { email: " " }],
      appUrl: "https://kawiil-central.mx",
    })!;
    expect(ev.subject).toBe("⚖️ Audiencia: Queja CONDUSEF");
    expect(ev.start).toEqual({ dateTime: "2026-10-29T14:00:00", timeZone: "America/Mexico_City" });
    expect(ev.end.dateTime).toBe("2026-10-29T15:00:00");
    expect(ev.isAllDay).toBe(false);
    expect(ev.location).toEqual({ displayName: "CONDUSEF" });
    expect(ev.attendees).toEqual([{ emailAddress: { address: "a@kawiil.mx", name: "Ana" }, type: "required" }]);
    expect(ev.body.content).toContain("Exp");
    expect(ev.body.content).toContain("lawsuitId=l1");
  });

  it("audiencia a las 23:30 termina al día siguiente", () => {
    const ev = buildLawsuitEvent({ ...base, next_hearing_time: "23:30" }, "audiencia", { attendees: [] })!;
    expect(ev.end.dateTime).toBe("2026-10-30T00:30:00");
  });

  it("sin hora o plazo: evento de todo el día", () => {
    const a = buildLawsuitEvent({ ...base, next_hearing_time: null }, "audiencia", { attendees: [] })!;
    expect(a.isAllDay).toBe(true);
    expect([a.start.dateTime, a.end.dateTime]).toEqual(["2026-10-29T00:00:00", "2026-10-30T00:00:00"]);
    const p = buildLawsuitEvent({ ...base, next_deadline_date: "2026-12-31" }, "plazo", { attendees: [] })!;
    expect(p.subject).toBe("⏰ Plazo: Queja CONDUSEF — Revisar cita");
    expect(p.end.dateTime).toBe("2027-01-01T00:00:00");
    expect(p.showAs).toBe("free");
    expect(p.location).toBeUndefined();
  });
});

describe("eventSlotChanged", () => {
  it("detecta cambios de fecha, hora, nota o nombre", () => {
    expect(eventSlotChanged(base, { ...base }, "audiencia")).toBe(false);
    expect(eventSlotChanged(base, { ...base, next_hearing_time: "14:00" }, "audiencia")).toBe(false);
    expect(eventSlotChanged(base, { ...base, next_hearing_time: "10:30" }, "audiencia")).toBe(true);
    expect(eventSlotChanged(base, { ...base, next_deadline_note: "Otra" }, "plazo")).toBe(true);
    expect(eventSlotChanged(base, { ...base, next_deadline_note: "Otra" }, "audiencia")).toBe(false);
    expect(eventSlotChanged(base, { ...base, name: "Nuevo" }, "plazo")).toBe(true);
    expect(eventSlotChanged(null, base, "audiencia")).toBe(true);
  });
});
