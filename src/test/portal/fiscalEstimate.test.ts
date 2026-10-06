import { describe, expect, it } from "vitest";
import {
  calculateFiscalEstimate,
  calculatePeriodIncome,
  ivaBasisLabel,
  type FiscalInvoice,
} from "../../portal/lib/fiscalEstimate";
import { dataQualityFromInvoices, mapDocTypeToStorage, vatByRateFromTaxLines, CENTRAL_SAT_DOCUMENT_PATH } from "../../../supabase/functions/_shared/portal/fiscalMirror.ts";

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

describe("espejo fiscal — casos adicionales", () => {
  it("reparte PPD en varios periodos según complementos", () => {
    const inv = invoice({
      id: "ppd-split",
      paymentMethod: "PPD",
      total: 1160,
      vatTransferred: 160,
      payments: [
        { paidAt: "2026-09-15", amount: 580 },
        { paidAt: "2026-10-05", amount: 580 },
      ],
    });
    const sep = calculateFiscalEstimate([inv], "2026-09-01", "2026-09-30");
    const oct = calculateFiscalEstimate([inv], "2026-10-01", "2026-10-31");
    expect(sep.vatTransferred).toBe(80);
    expect(oct.vatTransferred).toBe(80);
    expect(sep.pendingPayment).toEqual([]);
  });

  it("incluye tasas 8 %, 0 % y exento en el desglose", () => {
    const result = calculateFiscalEstimate([
      invoice({ id: "r8", direction: "recibida", vatTransferred: 80, vatByRate: { "8": 80 }, total: 1080 }),
      invoice({ id: "r0", direction: "recibida", vatTransferred: 0, vatByRate: { "0": 0 }, total: 500 }),
      invoice({ id: "ex", direction: "recibida", vatTransferred: 0, vatByRate: { exempt: 0 }, total: 200 }),
      invoice({ id: "e16", vatByRate: { "16": 160 } }),
    ], "2026-09-01", "2026-09-30");
    expect(result.byRate["8"]).toEqual({ transferred: 0, creditable: 80 });
    expect(result.byRate["16"].transferred).toBe(160);
    expect(result.vatCreditable).toBe(80);
  });

  it("PUE fuera del periodo no entra ni en flujo ni en emisión", () => {
    const inv = invoice({ id: "aug", issuedAt: "2026-08-20T00:00:00Z" });
    expect(calculateFiscalEstimate([inv], "2026-09-01", "2026-09-30").vatTransferred).toBe(0);
    expect(calculateFiscalEstimate([inv], "2026-09-01", "2026-09-30", "issuance").vatTransferred).toBe(0);
  });

  it("excluye facturas solo metadatos del estimado pero las cuenta en calidad", () => {
    const rows = [{ detail_status: "complete" }, { detail_status: "metadata" }, { detail_status: "metadata" }];
    const q = dataQualityFromInvoices(rows);
    expect(q).toMatchObject({ complete: 1, metadata_only: 2, quality_label: "baja" });
    const est = calculateFiscalEstimate([
      invoice({ id: "ok" }),
      invoice({ id: "meta", detailComplete: false, vatTransferred: 999 }),
    ], "2026-09-01", "2026-09-30");
    expect(est.vatTransferred).toBe(160);
    expect(est.metadataOnlyInvoices).toBe(1);
  });

  it("mapea tasas desde líneas de impuesto publicadas", () => {
    expect(vatByRateFromTaxLines([
      { tax: "IVA", kind: "transfer", rate: 0.16, base: 1000, amount: 160 },
      { tax: "IVA", kind: "transfer", rate: 8, base: 100, amount: 8 },
      { tax: "IVA", kind: "withholding", rate: 0.10667, base: 1000, amount: 106.67 },
    ])).toEqual({ "16": 160, "8": 8 });
  });

  it("documenta la regla PUE/PPD visible y la ruta F5 de constancia/opinión", () => {
    expect(ivaBasisLabel("cash_flow")).toMatch(/PUE/);
    expect(ivaBasisLabel("issuance")).toMatch(/emisión/i);
    expect(mapDocTypeToStorage("tax_status_certificate", "sat_document.publish")).toBe("constancia");
    expect(mapDocTypeToStorage("compliance_opinion", "sat_document.publish")).toBe("opinion_cumplimiento");
    expect(CENTRAL_SAT_DOCUMENT_PATH.table).toBe("public.moffin_consults");
    expect(CENTRAL_SAT_DOCUMENT_PATH.publish_op).toBe("sat_document.publish");
  });

  it("ingreso bruto del periodo: PUE subtotal y PPD porción bruta del complemento", () => {
    const income = calculatePeriodIncome([
      invoice({
        id: "pue",
        direction: "emitida",
        paymentMethod: "PUE",
        issuedAt: "2026-09-10",
        subtotal: 1000,
        total: 1160,
        detailComplete: true,
      }),
      invoice({
        id: "ppd",
        direction: "emitida",
        paymentMethod: "PPD",
        issuedAt: "2026-08-01",
        subtotal: 1000,
        total: 2000,
        detailComplete: true,
        payments: [{ paidAt: "2026-09-15", amount: 800 }],
      }),
      invoice({
        id: "ppd-pendiente",
        direction: "emitida",
        paymentMethod: "PPD",
        issuedAt: "2026-09-05",
        total: 500,
        detailComplete: true,
        payments: [],
      }),
    ], "2026-09-01", "2026-09-30");
    // PUE 1000 + PPD 800×(1000/2000)=400 → 1400
    expect(income.ingreso_total).toBe(1400);
    expect(income.ingreso_bruto).toBe(1400);
    expect(income.basis).toBe("subtotal");
    expect(income.pue_count).toBe(1);
    expect(income.ppd_complement_count).toBe(1);
    expect(income.pending_cobranza).toBe(1);
  });
});
