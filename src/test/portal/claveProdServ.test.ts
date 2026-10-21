import { describe, expect, it } from "vitest";
import { assessClaveProdServ, isValidClaveProdServFormat, summarizeConceptKeyIssues } from "../../portal/lib/claveProdServ";

describe("claveProdServ", () => {
  it("acepta formato de 8 dígitos", () => {
    expect(isValidClaveProdServFormat("80101500")).toBe(true);
    expect(isValidClaveProdServFormat("ABC")).toBe(false);
    expect(isValidClaveProdServFormat("")).toBe(false);
  });

  it("marca faltante / inválida / no cuadra", () => {
    expect(assessClaveProdServ({ description: "Consultoría", product_service_key: null })?.code).toBe("faltante");
    expect(assessClaveProdServ({ description: "Consultoría", product_service_key: "XX" })?.code).toBe("formato_invalido");
    expect(assessClaveProdServ({ description: "Consultoría fiscal", product_service_key: "15101514" })?.code).toBe("no_cuadra");
    expect(assessClaveProdServ({ description: "Consultoría fiscal", product_service_key: "80101500" })).toBeNull();
  });

  it("resume badges cliente", () => {
    const s = summarizeConceptKeyIssues([
      { description: "OK", product_service_key: "80101500" },
      { description: "Sin clave", product_service_key: null },
      { description: "Consultoría con clave de gasolina", product_service_key: "15101514" },
    ]);
    expect(s.faltante).toBe(1);
    expect(s.no_cuadra).toBe(1);
    expect(s.label).toBe("Revisar claves de producto");
  });
});
