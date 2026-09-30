import { describe, expect, it } from "vitest";
import type { AssignMeetingClientMode } from "@/lib/mtg/assignMeetingClient";

describe("assignMeetingClient modes", () => {
  it("expone los dos modos de migración", () => {
    const modes: AssignMeetingClientMode[] = ["meeting", "tasks_only"];
    expect(modes).toContain("meeting");
    expect(modes).toContain("tasks_only");
  });
});
