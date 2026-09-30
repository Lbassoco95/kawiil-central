import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isForbiddenFileName, classifyFile, classifyAreaFolder, suggestPeriod, FORBIDDEN_EXTENSIONS, FORBIDDEN_NAME_PATTERN,
} from "../../../supabase/functions/_shared/portal/dropboxFilter.ts";

describe("filtro de archivos de Dropbox", () => {
  it.each(["acme.key", "ACME.CER", "anual.dec", "sello.pfx", "x.p12", "FIEL vigente.pdf", "e.firma.zip", "CIEC.txt",
    "csd.pdf", "Contraseña.docx", "password.xlsx", "clave SAT.pdf"])("rechaza %s", (n) => expect(isForbiddenFileName(n)).toBe(true));
  it.each(["Declaración anual.pdf", "Opinión de cumplimiento.pdf", "balanza.xlsx", "factura.xml"])("acepta %s", (n) =>
    expect(classifyFile({ name: n }).accept).toBe(true));
  it("áreas: lista blanca", () => {
    expect(classifyAreaFolder("FISCAL").accept).toBe(true);
    expect(classifyAreaFolder("Contabilidad").accept).toBe(true);
    expect(classifyAreaFolder("ADMINISTRATIVO").reason).toBe("area_prohibida");
    expect(classifyAreaFolder("Recursos Humanos").reason).toBe("area_solo_subida_expresa");
    expect(classifyAreaFolder("Varios").reason).toBe("fuera_de_area");
  });
  it("periodo sugerido", () => {
    expect(suggestPeriod(["2026", "08"])).toEqual({ year: 2026, month: 8 });
    expect(suggestPeriod(["2025", "Septiembre"])).toEqual({ year: 2025, month: 9 });
  });
  it("espejo exacto de portal_is_forbidden_filename() en la migración", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929110200_portal_documents.sql"), "utf8");
    const ext = sql.match(/\\\.\((key\|[a-z0-9|]+)\)\$/)![1].split("|");
    expect(ext.sort()).toEqual([...FORBIDDEN_EXTENSIONS].sort());
    const words = sql.match(/'\((fiel\|[^']+)\)'/)![1].replace(/\\\./g, ".").replace(/\\-/g, "-");
    expect(words).toBe(FORBIDDEN_NAME_PATTERN.source.slice(1, -1).replace(/\\\./g, ".").replace(/\\-/g, "-"));
  });
});
