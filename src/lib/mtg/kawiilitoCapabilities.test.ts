import { describe, expect, it } from "vitest";
import { assessKawiilitoCapabilities } from "./kawiilitoCapabilities";

describe("assessKawiilitoCapabilities", () => {
  it("sin link recomienda browser y aclara que Hetzner no entra a la call", () => {
    const s = assessKawiilitoCapabilities({
      status: "planned",
      teamsJoinUrl: null,
      teamsOnlineMeetingId: null,
    });
    expect(s.botJoinConnected).toBe(false);
    expect(s.hetznerBrainForMinutes).toBe(true);
    expect(s.recommended).toBe("browser_audio");
    expect(s.lines.some((l) => /no entra a la llamada/i.test(l))).toBe(true);
  });

  it("con link Teams recomienda grabar ahí y luego extraer / cerebro para minuta", () => {
    const s = assessKawiilitoCapabilities({
      status: "in_progress",
      teamsJoinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x",
      teamsOnlineMeetingId: "19:meeting_x",
    });
    expect(s.hasJoinUrl).toBe(true);
    expect(s.hasTeamsOnlineMeetingId).toBe(true);
    expect(s.recommended).toBe("teams_native_then_extract");
    expect(s.graphAutoExtractReady).toBe(false);
  });
});
