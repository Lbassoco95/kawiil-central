import { describe, it, expect } from "vitest";
import juunRegimen from "@/lib/juun/catalogs/c_RegimenFiscal.json";
import juunUso from "@/lib/juun/catalogs/c_UsoCFDI.json";
import { C_REGIMEN_FISCAL, C_USO_CFDI } from "../../../supabase/functions/_shared/portal/validate.ts";

describe("catálogos del SAT del portal", () => {
  it("son la misma fuente que Ju'un (no se separan)", () => {
    expect(C_REGIMEN_FISCAL).toEqual(juunRegimen.entries);
    expect(C_USO_CFDI).toEqual(juunUso.entries);
  });
});
