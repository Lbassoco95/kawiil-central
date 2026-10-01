import { describe, expect, it } from "vitest";
import { buildEntitiesFromClientIds } from "./assignMeetingClients";

describe("assignMeetingClients", () => {
  it("buildEntitiesFromClientIds exige al menos un id", async () => {
    await expect(buildEntitiesFromClientIds([])).rejects.toThrow(/al menos un cliente/i);
  });
});
