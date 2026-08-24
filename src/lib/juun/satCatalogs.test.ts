import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  C_REGIMEN_FISCAL,
  C_USO_CFDI,
  REGIMEN_FISCAL_CLAVES,
  USO_CFDI_CLAVES,
  USO_CFDI_DEFAULT,
  etiquetaCatalogo,
  getRegimenFiscal,
  isRegimenFiscalValido,
  isUsoCfdiValido,
} from "@/lib/juun/satCatalogs";

const MIGRACION = resolve(
  process.cwd(),
  "supabase/migrations/20260824220000_juun_fis_schema.sql"
);

/** Saca la lista de valores de un CHECK `columna IN ('a','b',...)` de la migración. */
function clavesDelCheck(sql: string, columna: string): string[] {
  const re = new RegExp(`${columna}\\s+IN\\s*\\(([^)]*)\\)`, "i");
  const m = sql.match(re);
  if (!m) throw new Error(`No encontré el CHECK de ${columna} en la migración`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("catálogos del SAT", () => {
  it("c_RegimenFiscal trae las 19 claves y ninguna repetida", () => {
    expect(C_REGIMEN_FISCAL).toHaveLength(19);
    expect(new Set(REGIMEN_FISCAL_CLAVES).size).toBe(19);
  });

  it("c_UsoCFDI trae las 24 claves y ninguna repetida", () => {
    expect(C_USO_CFDI).toHaveLength(24);
    expect(new Set(USO_CFDI_CLAVES).size).toBe(24);
  });

  it("toda entrada tiene descripción", () => {
    for (const e of [...C_REGIMEN_FISCAL, ...C_USO_CFDI]) {
      expect(e.descripcion.trim().length).toBeGreaterThan(3);
    }
  });

  it("el uso por omisión es G03 y existe", () => {
    expect(USO_CFDI_DEFAULT).toBe("G03");
    expect(isUsoCfdiValido(USO_CFDI_DEFAULT)).toBe(true);
  });

  it("rechaza claves que no están en el catálogo", () => {
    expect(isRegimenFiscalValido("699")).toBe(false);
    expect(isUsoCfdiValido("G99")).toBe(false);
    expect(isRegimenFiscalValido(null)).toBe(false);
  });

  it("etiquetaCatalogo arma «clave — descripción»", () => {
    expect(etiquetaCatalogo({ clave: "601", descripcion: "General de Ley Personas Morales" })).toBe(
      "601 — General de Ley Personas Morales"
    );
  });

  it("getRegimenFiscal devuelve la entrada completa", () => {
    expect(getRegimenFiscal("626")?.descripcion).toMatch(/Simplificado de Confianza/);
    expect(getRegimenFiscal("000")).toBeNull();
  });
});

// Estas dos pruebas son el contrato entre el front y la base: si alguien
// agrega una clave en un lado y no en el otro, la base rechaza el INSERT en
// producción. Mejor que reviente aquí.
describe("los catálogos coinciden con los CHECK de la migración", () => {
  const sql = readFileSync(MIGRACION, "utf-8");

  it("regimen_fiscal", () => {
    expect(clavesDelCheck(sql, "regimen_fiscal").sort()).toEqual([...REGIMEN_FISCAL_CLAVES].sort());
  });

  it("uso_cfdi_default", () => {
    expect(clavesDelCheck(sql, "uso_cfdi_default").sort()).toEqual([...USO_CFDI_CLAVES].sort());
  });
});
