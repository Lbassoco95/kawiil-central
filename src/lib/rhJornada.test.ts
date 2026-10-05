import { describe, expect, it } from "vitest";
import {
  summarizeJornada,
  summarizeJornadaWithSession,
  type RhAttendance,
  type RhAttendanceEvent,
} from "@/lib/rh";
import { startOfDayMxISO, toDateStringMX } from "@/lib/dateUtils";

function event(
  partial: Partial<RhAttendanceEvent> & Pick<RhAttendanceEvent, "event_type" | "event_at">,
): RhAttendanceEvent {
  return {
    id: partial.id ?? "e1",
    attendance_id: partial.attendance_id ?? "a1",
    organization_id: "org",
    user_id: "u1",
    event_type: partial.event_type,
    event_at: partial.event_at,
    lat: null,
    lng: null,
    accuracy_m: null,
    within_geofence: null,
    office_location_id: null,
    created_at: partial.event_at,
  };
}

function session(partial: Partial<RhAttendance> & Pick<RhAttendance, "check_in_at">): RhAttendance {
  return {
    id: partial.id ?? "a1",
    organization_id: "org",
    user_id: "u1",
    work_date: partial.work_date ?? "2026-10-05",
    check_in_at: partial.check_in_at,
    check_out_at: partial.check_out_at ?? null,
    work_mode: partial.work_mode ?? "office",
    expected_work_mode: null,
    check_in_lat: null,
    check_in_lng: null,
    check_in_accuracy_m: null,
    within_geofence: null,
    office_location_id: null,
    check_out_lat: null,
    check_out_lng: null,
    notes: null,
    is_additional_shift: false,
    in_transit: false,
    created_at: partial.check_in_at,
    updated_at: partial.check_in_at,
  };
}

describe("summarizeJornadaWithSession", () => {
  const now = Date.parse("2026-10-05T16:00:00.000Z");

  it("usa eventos cuando existen", () => {
    const s = session({ check_in_at: "2026-10-05T15:00:00.000Z" });
    const events = [event({ event_type: "check_in", event_at: "2026-10-05T15:00:00.000Z" })];
    const summary = summarizeJornadaWithSession(s, events, now);
    expect(summary.state).toBe("working");
    expect(summary.workedMs).toBe(summarizeJornada(events, now).workedMs);
  });

  it("si hay sesión abierta sin eventos, no muestra Sin iniciar", () => {
    const s = session({ check_in_at: "2026-10-05T15:00:00.000Z" });
    const summary = summarizeJornadaWithSession(s, [], now);
    expect(summary.state).toBe("working");
    expect(summary.workedMs).toBe(60 * 60_000);
  });

  it("si hay sesión cerrada sin eventos, marca done", () => {
    const s = session({
      check_in_at: "2026-10-05T15:00:00.000Z",
      check_out_at: "2026-10-05T18:00:00.000Z",
    });
    const summary = summarizeJornadaWithSession(s, [], now);
    expect(summary.state).toBe("done");
    expect(summary.workedMs).toBe(3 * 60 * 60_000);
  });

  it("sin sesión sigue en none", () => {
    expect(summarizeJornadaWithSession(null, [], now).state).toBe("none");
  });
});

describe("fechas CDMX para jornada", () => {
  it("toDateStringMX y startOfDayMxISO son coherentes", () => {
    const ymd = toDateStringMX();
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const start = startOfDayMxISO();
    expect(Date.parse(start)).not.toBeNaN();
    // La medianoche CDMX en ISO cae en 06:00Z (CST) o 05:00Z (CDT).
    expect(start.endsWith("Z")).toBe(true);
  });
});
