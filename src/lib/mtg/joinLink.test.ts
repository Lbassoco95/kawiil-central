import { describe, expect, it } from "vitest";
import {
  extractTeamsOnlineMeetingId,
  extractUrlFromPaste,
  parseMeetingJoinLink,
} from "./joinLink";

describe("joinLink", () => {
  it("extrae URL de texto con basura", () => {
    expect(
      extractUrlFromPaste("Entra aquí: https://teams.microsoft.com/l/meetup-join/abc/0 gracias"),
    ).toContain("teams.microsoft.com");
  });

  it("parsea Teams y saca meeting id", () => {
    const id = "19:meeting_AbC123@thread.v2";
    const url = `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(id)}/0?context=%7B%7D`;
    const parsed = parseMeetingJoinLink(url);
    expect(parsed.provider).toBe("teams");
    expect(parsed.label).toBe("Teams");
    expect(parsed.teamsOnlineMeetingId).toBe(id);
    expect(extractTeamsOnlineMeetingId(url)).toBe(id);
  });

  it("parsea Google Meet", () => {
    const parsed = parseMeetingJoinLink("https://meet.google.com/abc-defg-hij");
    expect(parsed.provider).toBe("google_meet");
    expect(parsed.teamsOnlineMeetingId).toBeNull();
  });

  it("rechaza texto sin URL", () => {
    expect(() => parseMeetingJoinLink("sin link")).toThrow(/enlace válido/i);
  });
});
