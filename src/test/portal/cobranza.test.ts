import { describe, expect, it } from "vitest";
import {
  deriveCobranza,
  metodoPagoLabel,
  relatedUuidFromFlags,
  voucherTypeLabel,
} from "../../portal/lib/cobranza";

describe("deriveCobranza", () => {
  it("PUE → cobrado", () => {
    const c = deriveCobranza({ metodo_pago: "PUE", total: 11600 });
    expect(c.estado).toBe("pagado");
    expect(c.label).toBe("Cobrado");
  });

  it("PPD sin complemento → pendiente por cobrar", () => {
    const c = deriveCobranza({ metodo_pago: "PPD", total: 9280, paid_amount: 0 });
    expect(c.estado).toBe("pendiente");
    expect(c.label).toBe("Pendiente por cobrar");
  });

  it("PPD con pago parcial → cobrado parcial", () => {
    const c = deriveCobranza({ metodo_pago: "PPD", total: 9280, paid_amount: 4640 });
    expect(c.estado).toBe("parcial");
    expect(c.label).toBe("Cobrado parcial");
    expect(c.pendiente).toBe(4640);
  });

  it("PPD con complemento completo → cobrado", () => {
    expect(deriveCobranza({ metodo_pago: "PPD", total: 9280, paid_amount: 9280 }).label).toBe("Cobrado");
  });

  it("nota de crédito → descuento", () => {
    expect(deriveCobranza({ voucher_type: "E", total: 1000 }).label).toBe("Descuento");
    expect(deriveCobranza({ voucher_type: "P", total: 4640 }).label).toBe("Complemento");
  });

  it("metadatos sin método → sin dato de cobro (Detalle pendiente en UI)", () => {
    expect(deriveCobranza({ total: 0, detail_pending: true }).label).toBe("Sin dato de cobro");
  });

  it("monto sin método → por revisar (cobranza de negocio)", () => {
    const c = deriveCobranza({ total: 5000 });
    expect(c.estado).toBe("por_revisar");
    expect(c.label).toBe("Por revisar");
  });
});

describe("labels y flags", () => {
  it("etiquetas de tipo y método", () => {
    expect(voucherTypeLabel("I")).toBe("Ingreso");
    expect(voucherTypeLabel("E")).toBe("Descuento (nota de crédito)");
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
