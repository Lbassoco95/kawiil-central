import { describe, expect, it } from "vitest";
import {
  graphRangeFromDatetimeLocal,
  mapGraphEventToMeetingLink,
} from "./createOutlookEventForMeeting";

describe("graphRangeFromDatetimeLocal", () => {
  it("arma start/end en America/Mexico_City con la duración", () => {
    const range = graphRangeFromDatetimeLocal("2026-09-30T09:00", 60);
    expect(range.start).toEqual({
      dateTime: "2026-09-30T09:00:00",
      timeZone: "America/Mexico_City",
    });
    expect(range.end).toEqual({
      dateTime: "2026-09-30T10:00:00",
      timeZone: "America/Mexico_City",
    });
  });

  it("cruza medianoche", () => {
    const range = graphRangeFromDatetimeLocal("2026-09-30T23:30", 60);
    expect(range.end.dateTime).toBe("2026-10-01T00:30:00");
  });
});

describe("mapGraphEventToMeetingLink", () => {
  it("extrae id, joinUrl e id de Teams", () => {
    const link = mapGraphEventToMeetingLink({
      id: "AAMkAG…",
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x", id: "19:meeting_abc" },
    });
    expect(link.outlook_event_id).toBe("AAMkAG…");
    expect(link.teams_join_url).toContain("teams.microsoft.com");
    expect(link.teams_online_meeting_id).toBe("19:meeting_abc");
    expect(link.onlineMeetingFallback).toBe(false);
  });

  it("marca fallback si Graph no devolvió joinUrl", () => {
    const link = mapGraphEventToMeetingLink({ id: "evt-1", onlineMeetingFallback: true });
    expect(link.teams_join_url).toBeNull();
    expect(link.onlineMeetingFallback).toBe(true);
  });
});
