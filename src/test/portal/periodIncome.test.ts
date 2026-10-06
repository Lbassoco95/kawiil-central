import { describe, expect, it } from "vitest";
import { calendarMonthBounds, sumPeriodRecognizedIncome } from "../../portal/lib/periodIncome";

describe("sumPeriodRecognizedIncome", () => {
  const { start, end } = calendarMonthBounds(2026, 9);

  it("PUE cuenta en el mes de emisión", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        metodo_pago: "PUE",
        fecha: "2026-09-12T10:00:00Z",
        total: 11600,
        sat_status: "vigente",
      }],
      start,
      end,
    );
    expect(r.total).toBe(11600);
    expect(r.pueCount).toBe(1);
  });

  it("PPD sin complemento no suma (pendiente por cobrar)", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        metodo_pago: "PPD",
        fecha: "2026-09-05T10:00:00Z",
        total: 9280,
        sat_status: "vigente",
        paid_amount: 0,
        payments: [],
      }],
      start,
      end,
    );
    expect(r.total).toBe(0);
    expect(r.pendingCobranzaCount).toBe(1);
  });

  it("PPD con complemento suma en el mes del pago", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        metodo_pago: "PPD",
        fecha: "2026-08-01T10:00:00Z",
        total: 9280,
        sat_status: "vigente",
        payments: [{ paid_at: "2026-09-20", paid_amount: 4640 }],
      }],
      start,
      end,
    );
    expect(r.total).toBe(4640);
    expect(r.ppdComplementCount).toBe(1);
  });

  it("sin método no inventa ingreso", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        fecha: "2026-09-01",
        total: 0,
        sat_status: "vigente",
      }],
      start,
      end,
    );
    expect(r.total).toBe(0);
  });
});
