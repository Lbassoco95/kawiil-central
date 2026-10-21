import { describe, expect, it } from "vitest";
import {
  brutoFromPaidAmount,
  calendarMonthBounds,
  sumPeriodRecognizedExpense,
  sumPeriodRecognizedIncome,
} from "../../portal/lib/periodIncome";

describe("sumPeriodRecognizedIncome (bruto = subtotal)", () => {
  const { start, end } = calendarMonthBounds(2026, 9);

  it("PUE cuenta subtotal (no total con IVA) en el mes de emisión", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        metodo_pago: "PUE",
        fecha: "2026-09-12T10:00:00Z",
        subtotal: 10000,
        total: 11600,
        sat_status: "vigente",
      }],
      start,
      end,
    );
    expect(r.total).toBe(10000);
    expect(r.basis).toBe("subtotal");
    expect(r.pueCount).toBe(1);
  });

  it("PPD sin complemento no suma (pendiente por cobrar)", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        metodo_pago: "PPD",
        fecha: "2026-09-05T10:00:00Z",
        subtotal: 8000,
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

  it("PPD con complemento suma porción bruta en el mes del pago", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        metodo_pago: "PPD",
        fecha: "2026-08-01T10:00:00Z",
        subtotal: 8000,
        total: 9280,
        sat_status: "vigente",
        payments: [{ paid_at: "2026-09-20", paid_amount: 4640 }],
      }],
      start,
      end,
    );
    // 4640 × (8000/9280) ≈ 4000
    expect(r.total).toBe(4000);
    expect(r.ppdComplementCount).toBe(1);
  });

  it("sin método no inventa ingreso", () => {
    const r = sumPeriodRecognizedIncome(
      [{
        direction: "emitida",
        fecha: "2026-09-01",
        subtotal: 0,
        total: 0,
        sat_status: "vigente",
      }],
      start,
      end,
    );
    expect(r.total).toBe(0);
  });
});

describe("brutoFromPaidAmount", () => {
  it("proporciona subtotal/total", () => {
    expect(brutoFromPaidAmount(1000, 1160, 580)).toBeCloseTo(500, 5);
  });
  it("sin total no inventa", () => {
    expect(brutoFromPaidAmount(1000, 0, 580)).toBe(0);
  });
});

describe("sumPeriodRecognizedExpense", () => {
  const { start, end } = calendarMonthBounds(2026, 9);

  it("usa subtotal de recibidas en el periodo", () => {
    const r = sumPeriodRecognizedExpense(
      [
        {
          direction: "recibida",
          fecha: "2026-09-10",
          subtotal: 500,
          total: 580,
          sat_status: "vigente",
        },
        {
          direction: "recibida",
          fecha: "2026-08-10",
          subtotal: 999,
          total: 1158,
          sat_status: "vigente",
        },
      ],
      start,
      end,
    );
    expect(r.total).toBe(500);
    expect(r.count).toBe(1);
    expect(r.basis).toBe("subtotal");
  });
});
