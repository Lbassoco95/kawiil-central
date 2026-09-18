import { describe, it, expect } from "vitest";
import { assertCanStart, assertCanEnd, unreviewedCount } from "@/lib/mtg/meetingLifecycle";

describe("meetingLifecycle transitions", () => {
  it("start solo desde planned", () => {
    expect(() => assertCanStart("planned")).not.toThrow();
    expect(() => assertCanStart("in_progress")).toThrow();
  });
  it("end desde in_progress o planned", () => {
    expect(() => assertCanEnd("in_progress")).not.toThrow();
    expect(() => assertCanEnd("planned")).not.toThrow();
    expect(() => assertCanEnd("closed")).toThrow();
  });
  it("unreviewedCount", () => {
    expect(unreviewedCount([{ reviewed: true }, { reviewed: false }])).toBe(1);
  });
});
