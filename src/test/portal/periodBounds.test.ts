import { describe, expect, it } from "vitest";
import { monthBounds, rangeBounds, weekBounds } from "../../portal/lib/periodBounds";

describe("periodBounds", () => {
  it("monthBounds cubre el mes completo", () => {
    const b = monthBounds(2026, 9);
    expect(b.kind).toBe("mes");
    expect(b.start).toBe("2026-09-01");
    expect(b.end).toBe("2026-09-30");
    expect(b.label).toContain("2026");
  });

  it("weekBounds lun–dom alrededor de un miércoles", () => {
    const b = weekBounds("2026-10-07"); // miércoles
    expect(b.kind).toBe("semana");
    expect(b.start).toBe("2026-10-05");
    expect(b.end).toBe("2026-10-11");
  });

  it("rangeBounds valida orden", () => {
    expect(rangeBounds("2026-01-01", "2026-01-15").label).toBe("2026-01-01 → 2026-01-15");
    expect(() => rangeBounds("2026-02-01", "2026-01-01")).toThrow();
  });
});
