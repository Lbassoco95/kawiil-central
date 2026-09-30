import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
// @ts-expect-error módulo .mjs sin tipos
import { parseSatWorkbook } from "../../../tools/portal/satCatalogParser.mjs";

/** Libro con la forma del catCFDI oficial (encabezados en un renglón intermedio). Datos de prueba. */
function libro() {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add("c_RegimenFiscal", [["Catálogo de régimen fiscal"], [], ["c_RegimenFiscal", "Descripción", "Física", "Moral", "Fecha de inicio de vigencia", "Fecha de fin de vigencia"],
    ["601", "General de Ley Personas Morales", "No", "Sí", "", ""], ["612", "Actividades Empresariales", "Sí", "No", "", ""]]);
  add("c_UsoCFDI", [["Catálogo de uso"], ["c_UsoCFDI", "Descripción", "Aplica para tipo persona Física", "Moral", "Fecha inicio de vigencia", "Fecha fin de vigencia", "Régimen Fiscal Receptor"],
    ["G03", "Gastos en general", "Sí", "Sí", "", "", "601, 612"], ["S01", "Sin efectos fiscales", "Sí", "Sí", "", "", "601,612,616"]]);
  add("c_FormaPago", [["c_FormaPago", "Descripción", "Fecha fin de vigencia"], ["1", "Efectivo", ""], ["99", "Por definir", ""]]);
  return wb;
}

describe("generador de catálogos del SAT", () => {
  it("arma la matriz régimen × uso desde la columna oficial", () => {
    const out = parseSatWorkbook(XLSX, libro(), "catCFDI_V_4_20990101.xls");
    expect(out.c_UsoCFDI_RegimenReceptor.entries).toEqual([
      { uso: "G03", regimenes: ["601", "612"] }, { uso: "S01", regimenes: ["601", "612", "616"] }]);
    expect(out.c_RegimenFiscal.entries[0]).toMatchObject({ clave: "601", fisica: false, moral: true });
    expect(out.c_FormaPago.entries.map((e: { clave: string }) => e.clave)).toEqual(["01", "99"]);
    expect(out.c_UsoCFDI._meta).toMatchObject({ fuente: "catCFDI_V_4_20990101.xls", publicado: "20990101" });
  });
});
