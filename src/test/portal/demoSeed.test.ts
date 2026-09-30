import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_FISCAL_MARK, isPortalDemoMode } from "../../portal/lib/demo";

const root = resolve(__dirname, "../../..");
const constants = JSON.parse(readFileSync(resolve(root, "kawiil-os/demo/constants.json"), "utf8"));
const dataset = JSON.parse(readFileSync(resolve(root, "kawiil-os/demo/fixtures/mirror-dataset.json"), "utf8"));

describe("demo espejo (Corte 4)", () => {
  it("expone la marca fiscal canónica", () => {
    expect(DEMO_FISCAL_MARK).toBe("DEMO — sin validez fiscal");
    expect(constants.mark).toBe(DEMO_FISCAL_MARK);
  });

  it("solo activa el modo demo con la bandera de build", () => {
    expect(isPortalDemoMode()).toBe(false);
  });

  it("el fixture cubre el espejo sin RH ni emisión", () => {
    expect(dataset.company.rh_enabled).toBe(false);
    expect(dataset.company.tickets_enabled).toBe(false);
    expect(dataset.settings.demo_mode).toBe(true);
    expect(dataset.settings.emission_enabled).toBe(false);
    expect(dataset.invoices).toHaveLength(4);
    expect(dataset.invoices.every((i: { is_test: boolean }) => i.is_test === true)).toBe(true);
    expect(dataset.invoices.some((i: { detail_status: string }) => i.detail_status === "metadata")).toBe(true);
    expect(dataset.invoices.some((i: { direction: string }) => i.direction === "emitida")).toBe(true);
    expect(dataset.invoices.some((i: { direction: string }) => i.direction === "recibida")).toBe(true);
    expect(dataset.documents.map((d: { doc_type: string }) => d.doc_type).sort()).toEqual([
      "constancia",
      "declaracion",
      "opinion_cumplimiento",
    ]);
    expect(dataset.alerts.map((a: { alert_type: string }) => a.alert_type).sort()).toEqual([
      "cancelacion",
      "efos",
    ]);
    expect(dataset.sat_notifications).toHaveLength(1);
    expect(dataset.fiscal_summary.period_year).toBe(2026);
    expect(dataset.fiscal_summary.period_month).toBe(9);
  });

  it("la semilla SQL declara la marca y apaga RH/emisión", () => {
    const seed = readFileSync(resolve(root, "kawiil-os/demo/seed.sql"), "utf8");
    expect(seed).toContain("DEMO — sin validez fiscal");
    expect(seed).toContain("demo_mode");
    expect(seed).toMatch(/emission_enabled[\s\S]*false/);
    expect(seed).toContain("rh_enabled");
    expect(seed).toContain("'efos'");
    expect(seed).toContain("'cancelacion'");
    expect(seed).toContain("'constancia'");
    expect(seed).toContain("'opinion_cumplimiento'");
    expect(seed).toContain("'declaracion'");
  });
});
