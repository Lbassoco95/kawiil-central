import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearchText, searchRank, searchTokens } from "./searchMatch";

describe("normalizeSearchText", () => {
  it("quita acentos y baja a minúsculas", () => {
    expect(normalizeSearchText("José María Peña")).toBe("jose maria pena");
    expect(normalizeSearchText("Constitución")).toBe("constitucion");
  });

  it("convierte puntuación en separadores", () => {
    expect(normalizeSearchText("polo@kawiil.mx")).toBe("polo kawiil mx");
    expect(normalizeSearchText("S.A. de C.V.")).toBe("s a de c v");
  });

  it("tolera nulos", () => {
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("searchTokens", () => {
  it("parte la consulta en tokens normalizados", () => {
    expect(searchTokens("  José  María ")).toEqual(["jose", "maria"]);
  });

  it("una consulta vacía no produce tokens", () => {
    expect(searchTokens("   ")).toEqual([]);
  });
});

describe("matchesSearch", () => {
  it("encuentra por prefijo del nombre", () => {
    expect(matchesSearch("Mariso", ["Marisol Hernández"])).toBe(true);
  });

  it("encuentra escribiendo sin acentos", () => {
    expect(matchesSearch("hernandez", ["Marisol Hernández"])).toBe(true);
    expect(matchesSearch("jose", ["José Luis Ramírez"])).toBe(true);
  });

  it("encuentra con el acento escrito aunque el dato no lo tenga", () => {
    expect(matchesSearch("Ramírez", ["Jose Luis Ramirez"])).toBe(true);
  });

  it("no depende del orden de las palabras", () => {
    expect(matchesSearch("hernandez marisol", ["Marisol Hernández"])).toBe(true);
  });

  it("busca en todos los campos, no sólo en el nombre", () => {
    const cliente = ["Grupo Textil del Norte", "GTN180101AB1", "marisol@gtn.mx", "Marisol Ruiz"];
    expect(matchesSearch("marisol", cliente)).toBe(true);
    expect(matchesSearch("GTN1801", cliente)).toBe(true);
  });

  it("exige que todos los tokens coincidan", () => {
    expect(matchesSearch("marisol lopez", ["Marisol Hernández"])).toBe(false);
  });

  it("una consulta vacía deja pasar todo", () => {
    expect(matchesSearch("", ["lo que sea"])).toBe(true);
  });

  it("un registro sin campos con texto nunca coincide", () => {
    expect(matchesSearch("marisol", [null, undefined, ""])).toBe(false);
  });
});

describe("searchRank", () => {
  it("prioriza el prefijo exacto sobre la coincidencia interna", () => {
    const prefijo = searchRank("mari", "Marisol Hernández");
    const interna = searchRank("mari", "Ana Marisol Ruiz");
    const suelta = searchRank("mari", "Comercializadora Submarina");
    expect(prefijo).toBeLessThan(interna);
    expect(interna).toBeLessThan(suelta);
  });
});
