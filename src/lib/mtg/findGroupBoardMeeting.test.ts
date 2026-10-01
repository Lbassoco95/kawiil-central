import { describe, expect, it } from "vitest";
import { shouldSeekGroupBoard } from "./findGroupBoardMeeting";

describe("shouldSeekGroupBoard", () => {
  it("solo redirige juntas vacías sin serie (nunca si ya hay tablero)", () => {
    expect(
      shouldSeekGroupBoard({ series_id: null, status: "cancelled", topicUpdateCount: 0 }),
    ).toBe(true);
    expect(
      shouldSeekGroupBoard({ series_id: null, status: "planned", topicUpdateCount: 0 }),
    ).toBe(true);
    expect(
      shouldSeekGroupBoard({
        series_id: "s1",
        status: "cancelled",
        topicUpdateCount: 10,
      }),
    ).toBe(false);
    expect(
      shouldSeekGroupBoard({
        series_id: "s1",
        status: "planned",
        topicUpdateCount: 10,
      }),
    ).toBe(false);
  });
});
