import { describe, expect, it } from "vitest";
import {
  deriveCobranza,
  metodoPagoLabel,
  relatedUuidFromFlags,
  voucherTypeLabel,
} from "../../portal/lib/cobranza";

describe("deriveCobranza", () => {
  it("PUE → pagado", () => {
    expect(deriveCobranza({ metodo_pago: "PUE", total: 11600 }).estado).toBe("pagado");
  });

  it("PPD sin complemento → pendiente", () => {
    const c = deriveCobranza({ metodo_pago: "PPD", total: 9280, paid_amount: 0 });
    expect(c.estado).toBe("pendiente");
    expect(c.label).toBe("Pendiente");
  });

  it("PPD con pago parcial → parcial", () => {
    const c = deriveCobranza({ metodo_pago: "PPD", total: 9280, paid_amount: 4640 });
    expect(c.estado).toBe("parcial");
    expect(c.pendiente).toBe(4640);
  });

  it("PPD con complemento completo → pagado", () => {
    expect(deriveCobranza({ metodo_pago: "PPD", total: 9280, paid_amount: 9280 }).estado).toBe("pagado");
  });

  it("nota de crédito / complemento → no_aplica", () => {
    expect(deriveCobranza({ voucher_type: "E", total: 1000 }).estado).toBe("no_aplica");
    expect(deriveCobranza({ voucher_type: "P", total: 4640 }).label).toBe("Complemento");
  });

  it("sin método (metadatos) → sin dato de cobro", () => {
    expect(deriveCobranza({ total: 0 }).label).toBe("Sin dato de cobro");
  });
});

describe("labels y flags", () => {
  it("etiquetas de tipo y método", () => {
    expect(voucherTypeLabel("I")).toBe("Ingreso");
    expect(voucherTypeLabel("E")).toBe("Nota de crédito");
    expect(metodoPagoLabel("PPD")).toBe("PPD");
  });

  it("extrae UUID de nota de crédito", () => {
    expect(
      relatedUuidFromFlags([
        { code: "nota_credito", reason: "Descuento sobre D1111111-1111-4111-8111-111111111111 (DEMO)" },
      ]),
    ).toBe("D1111111-1111-4111-8111-111111111111");
  });
});
