import { describe, it, expect } from "vitest";
import { buildMtgStoragePath } from "@/lib/mtg/storagePaths";

describe("buildMtgStoragePath", () => {
  it("incluye org, anchor y tipo", () => {
    const path = buildMtgStoragePath({
      organizationId: "a0000000-0000-0000-0000-000000000001",
      anchorType: "client",
      anchorId: "5629ce71-0a5c-4c76-aa50-9ce22e0cf191",
      kind: "minutes",
      fileName: "minuta.pdf",
      at: new Date("2026-09-18T12:00:00.000Z"),
      uniqueSuffix: "123",
    });
    expect(path).toMatch(
      /^a0000000-0000-0000-0000-000000000001\/mtg\/client\/5629ce71-0a5c-4c76-aa50-9ce22e0cf191\/2026\/09\/minutes\/123_minuta\.pdf$/
    );
  });
});
