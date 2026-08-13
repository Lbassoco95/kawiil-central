import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderTextWithMentionHighlights } from "./renderMentionHighlights";

/** Extrae solo el texto de los fragmentos resaltados como mención (con className). */
function highlightedMentions(nodes: ReturnType<typeof renderTextWithMentionHighlights>): string[] {
  return nodes
    .map((n) => n as ReactElement<{ className?: string; children?: string }>)
    .filter((n) => !!n.props?.className)
    .map((n) => n.props.children ?? "");
}

/** Reconstruye el texto plano completo a partir de los fragmentos. */
function plainText(nodes: ReturnType<typeof renderTextWithMentionHighlights>): string {
  return nodes
    .map((n) => (n as ReactElement<{ children?: string }>).props?.children ?? "")
    .join("");
}

describe("renderTextWithMentionHighlights", () => {
  it("resalta solo el nombre y no el resto de la frase (nombre conocido)", () => {
    const text = "@Habib Fernando Moreno Athie ya solamente nos falta un cliente, revisa.";
    const nodes = renderTextWithMentionHighlights(text, "t", {
      knownNames: ["Habib Fernando Moreno Athie", "Leopoldo Bassoco"],
    });
    expect(highlightedMentions(nodes)).toEqual(["@Habib Fernando Moreno Athie"]);
    expect(plainText(nodes)).toBe(text);
  });

  it("sin directorio, no engulle la frase: acota por palabras capitalizadas", () => {
    const text = "@Habib Fernando ya solamente nos falta un cliente";
    const nodes = renderTextWithMentionHighlights(text, "t");
    expect(highlightedMentions(nodes)).toEqual(["@Habib Fernando"]);
    expect(plainText(nodes)).toBe(text);
  });

  it("incluye partículas de nombres compuestos seguidas de palabra capitalizada", () => {
    const text = "hola @Juan de la Cruz, ¿cómo vas?";
    const nodes = renderTextWithMentionHighlights(text, "t");
    expect(highlightedMentions(nodes)).toEqual(["@Juan de la Cruz"]);
    expect(plainText(nodes)).toBe(text);
  });

  it("no confunde correos como menciones (@ pegado a palabra previa)", () => {
    const text = "escribe a correo@dominio.com por favor";
    const nodes = renderTextWithMentionHighlights(text, "t");
    expect(highlightedMentions(nodes)).toEqual([]);
    expect(plainText(nodes)).toBe(text);
  });

  it("resalta menciones precedidas de signos ((, ¿, comillas, guion)", () => {
    for (const [text, expected] of [
      ["revisa (@Habib Fernando) por favor", "@Habib Fernando"],
      ["¿@Habib puedes?", "@Habib"],
      ['"@Habib" dijo', "@Habib"],
    ] as const) {
      const nodes = renderTextWithMentionHighlights(text, "t");
      expect(highlightedMentions(nodes)).toEqual([expected]);
      expect(plainText(nodes)).toBe(text);
    }
  });

  it("resalta varias menciones conocidas en el mismo texto", () => {
    const text = "@Leopoldo Bassoco y @Habib Fernando Moreno Athie revisen esto";
    const nodes = renderTextWithMentionHighlights(text, "t", {
      knownNames: ["Leopoldo Bassoco", "Habib Fernando Moreno Athie"],
    });
    expect(highlightedMentions(nodes)).toEqual([
      "@Leopoldo Bassoco",
      "@Habib Fernando Moreno Athie",
    ]);
    expect(plainText(nodes)).toBe(text);
  });
});
