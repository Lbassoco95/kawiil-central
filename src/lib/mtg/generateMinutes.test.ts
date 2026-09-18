import { describe, it, expect } from "vitest";
import {
  MinutesModelOutputSchema,
  MOCK_MINUTES_OUTPUT,
  buildMinutesMarkdown,
  callOpenClawGateway,
} from "@/lib/mtg/generateMinutes";

describe("generateMinutes", () => {
  it("valida mock JSON", () => {
    expect(MinutesModelOutputSchema.parse(MOCK_MINUTES_OUTPUT).proposed_agreements).toHaveLength(2);
  });
  it("arma markdown en código", () => {
    const md = buildMinutesMarkdown({
      title: "Demo",
      scheduledAt: "2026-09-17",
      attendees: ["A", "B"],
      liveAgreements: [{ text: "Hacer X", status: "confirmed" }],
      decided: [{ text: "¿Y?", resolution: "Sí" }],
      model: MOCK_MINUTES_OUTPUT,
    });
    expect(md).toContain("# Minuta");
    expect(md).toContain("Hacer X");
    expect(md).toContain("Acuerdos propuestos");
  });
  it("mock gateway", async () => {
    const out = await callOpenClawGateway({
      gatewayUrl: "http://example.invalid",
      system: "x",
      user: "y",
      mock: true,
    });
    expect(out.proposed_agreements[0].transcript_ref).toMatch(/\d/);
  });
});
