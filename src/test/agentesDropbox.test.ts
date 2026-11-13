import { describe, it, expect } from "vitest";
import {
  RAICES_POR_DEFECTO, dentroDeRaices, entradaPublica, mimePorNombre, normalizarRaices, referenciaValida, tokensIguales,
} from "../../supabase/functions/_shared/dropboxEquipo";

describe("raíces autorizadas de Dropbox", () => {
  it("por defecto solo /kawiil mx/clientes; normaliza y descarta lo peligroso", () => {
    expect(normalizarRaices(undefined)).toEqual(RAICES_POR_DEFECTO);
    expect(normalizarRaices("/Kawiil Mx/CLIENTES/")).toEqual(["/kawiil mx/clientes"]);
    expect(normalizarRaices("Kawiil Mx/Clientes; /Otro/Carpeta ;/kawiil mx/clientes")).toEqual(["/kawiil mx/clientes", "/otro/carpeta"]);
    for (const peligro of ["/", "", "  ", "/a/../b", "\\", ";;"]) expect(normalizarRaices(peligro)).toEqual(RAICES_POR_DEFECTO);   // nunca toda la cuenta
  });
  it("dentro: la raíz y lo que cuelga de ella, por segmentos", () => {
    const r = normalizarRaices(undefined);
    for (const ok of ["/kawiil mx/clientes", "/Kawiil Mx/CLIENTES/", "/kawiil mx/clientes/acme/libros/acta 1.pdf"]) expect(dentroDeRaices(ok, r)).toBe(true);
    for (const no of ["/kawiil mx/clientes-viejos", "/kawiil mx/clientes-viejos/x", "/kawiil mx", "/otro/kawiil mx/clientes", "/kawiil mx/nomina/sueldos.xlsx",
      "/kawiil mx/clientes/../nomina", "kawiil mx/clientes/x", "", null, undefined, 5, {}]) expect(dentroDeRaices(no as unknown, r)).toBe(false);
  });
  it("referencias: id de Dropbox, «raiz» o ruta limpia", () => {
    for (const ok of ["raiz", "id:AbC123_-xyz", "/Kawiil Mx/CLIENTES/Acme"]) expect(referenciaValida(ok)).toBe(true);
    for (const no of ["id:", "id:a", "id:../x", "../x", "Kawiil", "/a/../b", "", 5, null, "/x\u0000y"]) expect(referenciaValida(no as unknown)).toBe(false);
  });
});

describe("secreto del puente", () => {
  it("compara en tiempo constante y rechaza vacíos", () => {
    expect(tokensIguales("abc123", "abc123")).toBe(true);
    for (const [a, b] of [["abc123", "abc124"], ["abc", "abc123"], ["", ""], ["x", ""], [null, "x"], ["x", undefined], [5, 5]]) expect(tokensIguales(a, b)).toBe(false);
  });
});

describe("lo que sale hacia la VM", () => {
  const r = normalizarRaices(undefined);
  const base = { ".tag": "file", id: "id:abc12345", name: "Libro de actas.pdf", path_lower: "/kawiil mx/clientes/acme/libro de actas.pdf", path_display: "/Kawiil Mx/CLIENTES/ACME/Libro de actas.pdf", size: 1200, server_modified: "2026-03-01T10:00:00Z" };
  it("archivo y carpeta dentro de la raíz", () => {
    expect(entradaPublica(base, r)).toEqual({ id: "id:abc12345", nombre: "Libro de actas.pdf", tipo: "archivo", tamano: 1200, modificado: "2026-03-01T10:00:00Z", ruta: "/Kawiil Mx/CLIENTES/ACME/Libro de actas.pdf" });
    expect(entradaPublica({ ...base, ".tag": "folder", size: undefined }, r)?.tipo).toBe("carpeta");
  });
  it("descarta lo de fuera, lo eliminado y lo malformado", () => {
    expect(entradaPublica({ ...base, path_lower: "/kawiil mx/nomina/x.pdf" }, r)).toBeNull();
    expect(entradaPublica({ ...base, ".tag": "deleted" }, r)).toBeNull();
    expect(entradaPublica({ ...base, id: 5 }, r)).toBeNull();
    expect(entradaPublica({ ...base, path_lower: undefined }, r)).toBeNull();     // sin ruta no se puede comprobar: falla cerrado
  });
  it("tipos de archivo legibles", () => {
    expect(mimePorNombre("Acta.PDF")).toBe("application/pdf");
    expect(mimePorNombre("a.docx")).toContain("wordprocessingml");
    expect(mimePorNombre("a.exe")).toBeNull(); expect(mimePorNombre("sin_extension")).toBeNull();
  });
});

import { limiteValido, raicesEfectivas } from "../../supabase/functions/_shared/dropboxEquipo";
describe("límite por fuente (la carpeta de un solo cliente)", () => {
  const AUT = ["/kawiil mx/clientes"];
  it("solo ids de Dropbox: nunca rutas ni basura", () => {
    expect(limiteValido("id:AAAAAAAAAAAAAAAAAAAAAB")).toBe(true);
    for (const x of ["/Kawiil Mx/CLIENTES/Vizum", "raiz", "id:", "id:../x", "id:a b c d e", "", null, 5, undefined]) expect(limiteValido(x)).toBe(false);
  });
  it("sin límite se usan las raíces autorizadas", () => { expect(raicesEfectivas(AUT, null)).toBe(AUT); });
  it("con límite, SOLO esa carpeta cuenta (las demás de clientes quedan fuera)", () => {
    const r = raicesEfectivas(AUT, "/Kawiil Mx/CLIENTES/VIZUM")!;
    expect(r).toEqual(["/kawiil mx/clientes/vizum"]);
    expect(dentroDeRaices("/kawiil mx/clientes/vizum/kyc/lista.pdf", r)).toBe(true);
    expect(dentroDeRaices("/kawiil mx/clientes/vizum", r)).toBe(true);
    expect(dentroDeRaices("/kawiil mx/clientes/otro cliente/acta.pdf", r)).toBe(false);
    expect(dentroDeRaices("/kawiil mx/clientes/vizum-sa/acta.pdf", r)).toBe(false);      // por segmentos: «vizum-sa» NO es «vizum»
    expect(dentroDeRaices("/kawiil mx/clientes", r)).toBe(false);                         // la carpeta de todos los clientes tampoco
  });
  it("un límite fuera de las autorizadas se rechaza (null)", () => {
    expect(raicesEfectivas(AUT, "/Kawiil Mx/Finanzas/2026")).toBeNull();
    expect(raicesEfectivas(AUT, "/Kawiil Mx/CLIENTES-VIEJOS/x")).toBeNull();
    expect(raicesEfectivas(AUT, "/")).toBeNull();
    expect(raicesEfectivas(AUT, "/Kawiil Mx/CLIENTES/../Finanzas")).toBeNull();
  });
});

import { MAX_BYTES_SUBIR, argAscii, nombreArchivoSeguro } from "../../supabase/functions/_shared/dropboxEquipo";
describe("guardar archivos en Dropbox (solo agregar)", () => {
  it("acepta nombres normales con extensión permitida y los deja limpios", () => {
    expect(nombreArchivoSeguro("Oficio 2026-1234.pdf")).toBe("Oficio 2026-1234.pdf");
    expect(nombreArchivoSeguro("  Oficio   CNBV  número 5.PDF ")).toBe("Oficio CNBV número 5.PDF");
    expect(nombreArchivoSeguro("lista.xlsx")).toBe("lista.xlsx");
  });
  it("quita rutas y caracteres peligrosos; nunca deja salir de la carpeta", () => {
    expect(nombreArchivoSeguro("../../etc/passwd.txt")).toBe("etc passwd.txt");
    expect(nombreArchivoSeguro("a\\b/c:d*e?.pdf")).toBe("a b c d e .pdf");
    expect(nombreArchivoSeguro(".hidden.pdf")).toBe("hidden.pdf");
  });
  it.each(["", "ab", "sinextension", "virus.exe", "script.js", "archivo.pdf.exe", "x".repeat(200) + ".pdf", null, 5, ".pdf"])("rechaza %j", (v) => {
    expect(nombreArchivoSeguro(v)).toBeNull();
  });
  it("la cabecera de Dropbox va en ASCII aunque el nombre lleve acentos", () => {
    const h = argAscii({ path: "/Kawiil Mx/CLIENTES/VIZUM/Oficios/Oficio número 5 – año.pdf", mode: "add" });
    expect(/^[\x20-\x7e]*$/.test(h)).toBe(true);
    expect(JSON.parse(h).path).toBe("/Kawiil Mx/CLIENTES/VIZUM/Oficios/Oficio número 5 – año.pdf");     // al decodificarlo vuelve igual
  });
  it("tope de tamaño", () => { expect(MAX_BYTES_SUBIR).toBe(8 * 1024 * 1024); });
});
