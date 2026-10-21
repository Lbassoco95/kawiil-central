import { describe, expect, it } from "vitest";
import {
  summarizeTaxLines,
  taxKindLabel,
  taxNameLabel,
  taxRateLabel,
} from "../../portal/lib/taxPresentation";

describe("taxPresentation", () => {
  it("mapea códigos SAT y tipos", () => {
    expect(taxNameLabel("002")).toBe("IVA");
    expect(taxNameLabel("IVA")).toBe("IVA");
    expect(taxKindLabel("transfer")).toBe("Traslado");
    expect(taxKindLabel("withholding")).toBe("Retención");
    expect(taxRateLabel(0.16)).toBe("16 %");
    expect(taxRateLabel(8)).toBe("8 %");
  });

  it("resume líneas de impuesto", () => {
    const s = summarizeTaxLines([
      { tax: "IVA", kind: "transfer", amount: 160 },
      { tax: "002", kind: "withholding", amount: 20 },
      { tax: "ISR", kind: "retencion", amount: 100 },
    ]);
    expect(s).toEqual({
      ivaTrasladado: 160,
      ivaRetenido: 20,
      isrRetenido: 100,
      other: 0,
    });
  });
});
