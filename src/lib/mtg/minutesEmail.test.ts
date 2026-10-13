import { describe, expect, it } from "vitest";
import { mdToPlainText, minutesToHtml, parseEmails } from "./minutesEmail";

describe("minutesToHtml", () => {
  it("renderiza negritas, cursivas y listas sin asteriscos", () => {
    const html = minutesToHtml("# Título\n\n**Fecha:** 2026-10-13\n\n- punto _(ref. 00:01)_");
    expect(html).toContain("<strong>Fecha:</strong>");
    expect(html).toContain("<em>(ref. 00:01)</em>");
    expect(html).toContain("<li");
    expect(html).not.toContain("**");
  });
});

describe("parseEmails", () => {
  it("separa por coma/espacio, valida y quita duplicados", () => {
    expect(parseEmails("a@x.com, b@y.mx; a@x.com  malo")).toEqual(["a@x.com", "b@y.mx"]);
  });
});

describe("mdToPlainText", () => {
  it("quita asteriscos y almohadillas dejando texto legible", () => {
    const t = mdToPlainText("# Resumen de junta\n\n**Fecha:** 2026-10-13\n\n## Compromisos\n- Enviar corte _(ref. 00:47)_\n- Otro");
    expect(t).not.toMatch(/[*#_]/);
    expect(t).toContain("RESUMEN DE JUNTA");
    expect(t).toContain("Fecha: 2026-10-13");
    expect(t).toContain("• Enviar corte (ref. 00:47)");
  });
  it("no rompe guiones bajos dentro de palabras", () => {
    expect(mdToPlainText("archivo_final.pdf")).toBe("archivo_final.pdf");
  });
});
