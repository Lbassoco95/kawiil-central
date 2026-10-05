import { afterEach, describe, expect, it } from "vitest";
import { shouldUseDemoFixtures } from "../../portal/lib/dataMode";
import { isPortalDemoMode } from "../../portal/lib/demo";
import { partyName, rankParties, type MirrorCfdi } from "../../portal/lib/mirrorInvoiceMap";

describe("dataMode (fase 1 espejo)", () => {
  const originalPath = window.location.pathname;

  afterEach(() => {
    window.history.replaceState({}, "", originalPath || "/");
  });

  it("no usa fixtures solo por VITE_PORTAL_DEMO_MODE (banner ≠ dataset)", () => {
    // En vitest la env de build no activa demo; la regla de producto es: fixtures ≠ demo banner.
    expect(isPortalDemoMode()).toBe(false);
    expect(shouldUseDemoFixtures()).toBe(false);
  });

  it("usa fixtures solo en /diseno", () => {
    window.history.replaceState({}, "", "/diseno");
    expect(shouldUseDemoFixtures()).toBe(true);
  });

  it("en rutas autenticadas (/ingresos) lee espejo, no sampleData", () => {
    window.history.replaceState({}, "", "/ingresos");
    expect(shouldUseDemoFixtures()).toBe(false);
  });
});

describe("mirrorInvoiceMap con metadatos $0", () => {
  const rows: MirrorCfdi[] = [
    {
      id: "1",
      uuid: "AAAAAAAA-1111-2222-3333-444444444444",
      direction: "emitida",
      fecha: "2026-09-01",
      rfc_emisor: "BVS211101H55",
      nombre_emisor: "Bassoco SC",
      rfc_receptor: null,
      nombre_receptor: null,
      total: 0,
      sat_status: "vigente",
      category_name: null,
      category_status: "sin_categoria",
      is_test: false,
      source: "satgo_facfiel",
    },
    {
      id: "2",
      uuid: "BBBBBBBB-1111-2222-3333-444444444444",
      direction: "emitida",
      fecha: "2026-09-02",
      rfc_emisor: "BVS211101H55",
      nombre_emisor: "Bassoco SC",
      rfc_receptor: null,
      nombre_receptor: null,
      total: 0,
      sat_status: "vigente",
      category_name: null,
      category_status: "sin_categoria",
      is_test: false,
      source: "satgo_facfiel",
    },
  ];

  it("nombra contraparte por UUID si no hay RFC/nombre", () => {
    expect(partyName(rows[0], "emitida")).toMatch(/^Folio AAAAAAAA/);
  });

  it("rankea por conteo cuando todos los montos son 0", () => {
    const ranked = rankParties(rows, "emitida");
    expect(ranked[0]?.name).toMatch(/^Folio /);
    expect(ranked[0]?.meta).toMatch(/monto no publicado/);
    expect(ranked.some((r) => /Costa Maya|Aldea del Sol/i.test(r.name))).toBe(false);
  });
});
