import { describe, expect, it } from "vitest";
import { calculateFiscalEstimate, type FiscalInvoice } from "../../portal/lib/fiscalEstimate";

const invoice = (patch: Partial<FiscalInvoice>): FiscalInvoice => ({
  id: "invoice",
  direction: "emitida",
  issuedAt: "2026-09-10T12:00:00Z",
  paymentMethod: "PUE",
  subtotal: 1000,
  total: 1160,
  vatTransferred: 160,
  vatWithheld: 0,
  incomeTaxWithheld: 0,
  vatByRate: { "16": 160 },
  detailComplete: true,
  ...patch,
});

describe("cash-flow fiscal estimate", () => {
  it("calculates PUE, proportional PPD, withholdings and rates", () => {
    const result = calculateFiscalEstimate([
      invoice({ id: "issued-pue", vatWithheld: 20, incomeTaxWithheld: 100 }),
      invoice({ id: "received-pue", direction: "recibida", total: 580, subtotal: 500, vatTransferred: 80, vatWithheld: 8, incomeTaxWithheld: 50, vatByRate: { "16": 80 } }),
      invoice({ id: "issued-ppd", paymentMethod: "PPD", payments: [{ paidAt: "2026-09-20", amount: 580 }] }),
      invoice({ id: "pending", paymentMethod: "PPD", payments: [] }),
      invoice({ id: "metadata", detailComplete: false }),
    ], "2026-09-01", "2026-09-30");
    expect(result).toMatchObject({
      vatTransferred: 240,
      vatCreditable: 80,
      vatWithheldFromCompany: 20,
      vatWithheldByCompany: 8,
      incomeTaxWithheldFromCompany: 100,
      incomeTaxWithheldByCompany: 50,
      estimatedVat: 148,
      pendingPayment: ["pending"],
      completeInvoices: 4,
      metadataOnlyInvoices: 1,
    });
    expect(result.byRate["16"]).toEqual({ transferred: 240, creditable: 80 });
    expect(result.invoiceIds.vatTransferred).toEqual(["issued-pue", "issued-ppd"]);
  });

  it("can explicitly use issuance basis when complements are unavailable", () => {
    const result = calculateFiscalEstimate([invoice({ id: "ppd", paymentMethod: "PPD", payments: [] })], "2026-09-01", "2026-09-30", "issuance");
    expect(result.vatTransferred).toBe(160);
    expect(result.pendingPayment).toEqual([]);
  });
});
