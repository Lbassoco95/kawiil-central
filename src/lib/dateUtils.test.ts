import { describe, expect, it } from "vitest";
import { formatDateMX, formatMX } from "./dateUtils";

describe("formatDateMX — fechas date-only sin desfase UTC", () => {
  it("no corre la fecha un día hacia atrás (regresión 13 vs 14)", () => {
    // "2026-08-14" mostraba "13/8/2026" en CDMX (UTC-6) porque `new Date("2026-08-14")`
    // es medianoche UTC. Debe mostrar el día 14.
    expect(formatDateMX("2026-08-14").startsWith("14/")).toBe(true);
  });

  it("coincide en día con formatMX para el mismo date-only", () => {
    // El detalle usa formatMX; el dashboard usa formatDateMX: deben concordar.
    expect(formatMX("2026-08-14", "dd")).toBe("14");
  });

  it("devuelve marcador para valores vacíos o inválidos", () => {
    expect(formatDateMX(null)).toBe("—");
    expect(formatDateMX("")).toBe("—");
  });
});
