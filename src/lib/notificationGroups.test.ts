import { describe, expect, it } from "vitest";
import { groupByMoment, momentOf } from "./notificationGroups";

const now = new Date(2026, 9, 21, 15, 0);
const at = (daysAgo: number) => new Date(2026, 9, 21 - daysAgo, 9, 0).toISOString();

describe("notificationGroups", () => {
  it("clasifica por momento", () => {
    expect(momentOf(at(0), now)).toBe("hoy");
    expect(momentOf(at(1), now)).toBe("ayer");
    expect(momentOf(at(4), now)).toBe("semana");
    expect(momentOf(at(10), now)).toBe("antes");
  });

  it("agrupa en orden y omite vacíos", () => {
    const groups = groupByMoment([{ created_at: at(10) }, { created_at: at(0) }, { created_at: at(0) }], now);
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([["hoy", 2], ["antes", 1]]);
  });
});
