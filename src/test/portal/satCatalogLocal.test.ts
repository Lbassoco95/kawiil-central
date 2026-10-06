import { describe, expect, it } from "vitest";
import { scoreApprox, suggestSatCatalogLocal } from "../../portal/lib/satCatalogLocal";

describe("satCatalogLocal — búsqueda aproximada", () => {
  it("sugiere contabilidad con texto corto 'conta'", () => {
    const hits = suggestSatCatalogLocal("c_ClaveProdServ", "conta", 5);
    expect(hits[0]?.clave).toBe("80131500");
  });

  it("sugiere por sinónimo 'nómina' aunque no esté en la descripción exacta digitada", () => {
    const hits = suggestSatCatalogLocal("c_ClaveProdServ", "nomina", 5);
    expect(hits.some((h) => h.clave === "80131503")).toBe(true);
  });

  it("prioriza coincidencia por prefijo de clave", () => {
    const hits = suggestSatCatalogLocal("c_ClaveProdServ", "801315", 5);
    expect(hits[0]?.clave.startsWith("801315")).toBe(true);
  });

  it("scoreApprox es 0 sin query", () => {
    expect(scoreApprox("", { clave: "1", descripcion: "x", synonyms: [] })).toBe(0);
  });
});
