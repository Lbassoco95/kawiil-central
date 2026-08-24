import { describe, expect, it } from "vitest";
import { estimateCommission, formatArrangement } from "./partnerArrangement";

describe("formatArrangement", () => {
  it("porcentaje sobre el primer pago", () => {
    expect(
      formatArrangement({
        commission_type: "porcentaje",
        commission_value: 10,
        commission_base: "primer_pago",
        commission_currency: "MXN",
      }),
    ).toBe("10% del primer pago");
  });

  it("monto fijo por lead entregado", () => {
    expect(
      formatArrangement({
        commission_type: "monto_fijo",
        commission_value: 5000,
        commission_base: "por_lead",
        commission_currency: "MXN",
      }),
    ).toContain("por lead entregado");
  });

  it("sin comisión e intercambio no prometen pago", () => {
    const base = { commission_value: null, commission_base: "primer_pago", commission_currency: "MXN" };
    expect(formatArrangement({ ...base, commission_type: "sin_comision" })).toBe("Sin comisión");
    expect(formatArrangement({ ...base, commission_type: "intercambio" })).toContain("sin pago");
  });

  it("valor pendiente cuando falta el porcentaje", () => {
    expect(
      formatArrangement({
        commission_type: "porcentaje",
        commission_value: null,
        commission_base: "contrato_total",
        commission_currency: "MXN",
      }),
    ).toBe("Porcentaje por definir");
  });
});

describe("estimateCommission", () => {
  const pct = {
    commission_type: "porcentaje",
    commission_value: 10,
    commission_base: "primer_pago",
    commission_currency: "USD", // se ignora: la base del lead está en MXN
  };

  it("porcentaje sobre el valor estimado, siempre en MXN", () => {
    expect(estimateCommission(pct, 32000)).toEqual({ amount: 3200, currency: "MXN", manual: false });
  });

  it("redondea a dos decimales", () => {
    expect(estimateCommission({ ...pct, commission_value: 7.5 }, 1333).amount).toBe(99.98);
  });

  it("sin valor base no inventa monto", () => {
    expect(estimateCommission(pct, null).amount).toBeNull();
  });

  it("monto fijo respeta la moneda del convenio", () => {
    expect(
      estimateCommission(
        {
          commission_type: "monto_fijo",
          commission_value: 500,
          commission_base: "por_lead",
          commission_currency: "USD",
        },
        90000,
      ),
    ).toEqual({ amount: 500, currency: "USD", manual: false });
  });

  it("sin comisión devenga cero (mide el aporte del partner)", () => {
    expect(
      estimateCommission(
        {
          commission_type: "sin_comision",
          commission_value: null,
          commission_base: "primer_pago",
          commission_currency: "MXN",
        },
        50000,
      ).amount,
    ).toBe(0);
  });

  it("arreglo especial se marca para captura manual", () => {
    const r = estimateCommission(
      {
        commission_type: "otro",
        commission_value: null,
        commission_base: "primer_pago",
        commission_currency: "MXN",
      },
      50000,
    );
    expect(r.manual).toBe(true);
    expect(r.amount).toBeNull();
  });
});
