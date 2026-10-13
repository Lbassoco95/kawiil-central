import { describe, expect, it } from "vitest";
import { minutesToHtml, parseEmails } from "./minutesEmail";

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
