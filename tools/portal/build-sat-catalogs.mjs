#!/usr/bin/env node
/**
 * Uso: node tools/portal/build-sat-catalogs.mjs ~/Descargas/catCFDI_V_4_AAAAMMDD.xls
 * Escribe supabase/functions/_shared/portal/catalogs/*.json. Después:
 *   npm run test   → catalogos.test.ts avisa si c_RegimenFiscal/c_UsoCFDI se separaron de
 *                    los de Ju'un (src/lib/juun/catalogs); cópielos también ahí y agregue una
 *                    migración si el CHECK de fis_tax_profiles necesita claves nuevas.
 */
import { writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import XLSX from "xlsx";
import { parseSatWorkbook } from "./satCatalogParser.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Falta la ruta del catCFDI_V_4_*.xls oficial del SAT.");
  process.exit(1);
}
const out = parseSatWorkbook(XLSX, XLSX.readFile(file), basename(file));
const dir = resolve(process.cwd(), "supabase/functions/_shared/portal/catalogs");
for (const [name, data] of Object.entries(out)) {
  writeFileSync(`${dir}/${name}.json`, JSON.stringify(data, null, 2) + "\n");
  console.log(`${name}: ${data.entries.length} claves`);
}
