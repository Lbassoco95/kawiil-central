import { describe, expect, it } from "vitest";
import {
  extractSavioIdFromWriteData,
  extractSavioInvoiceIdFromWriteData,
} from "./clientSavioLink";

describe("extractSavioIdFromWriteData", () => {
  it("respuesta plana con id uuid", () => {
    expect(extractSavioIdFromWriteData({ id: "cust-uuid-abc" })).toBe("cust-uuid-abc");
  });

  it("respuesta envuelta en data", () => {
    expect(
      extractSavioIdFromWriteData({
        data: { customer_id: "nested-xyz" },
      }),
    ).toBe("nested-xyz");
  });
});

describe("extractSavioInvoiceIdFromWriteData", () => {
  it("prioriza invoice_id", () => {
    expect(extractSavioInvoiceIdFromWriteData({ invoice_id: "inv-1", id: "other" })).toBe("inv-1");
  });

  it("cae en charge_id cuando hace falta", () => {
    expect(extractSavioInvoiceIdFromWriteData({ charge_id: "chg-999" })).toBe("chg-999");
  });

  it("lee id anidado en data", () => {
    expect(
      extractSavioInvoiceIdFromWriteData({
        data: { uuid: "inv-inner" },
      }),
    ).toBe("inv-inner");
  });

  it("null si no hay claves conocidas", () => {
    expect(extractSavioInvoiceIdFromWriteData({ foo: "bar" })).toBe(null);
    expect(extractSavioInvoiceIdFromWriteData(null)).toBe(null);
  });
});
