import { describe, expect, it } from "vitest";
import {
  parseComment,
  attachmentsToLines,
  combineBodyAndAttachments,
  isRichHtml,
  plainTextToEditableHtml,
  sanitizeCommentHtml,
  richTextIsEmpty,
  commentPlainText,
} from "./commentContent";

describe("parseComment", () => {
  it("separa cuerpo y adjuntos", () => {
    const content = "Revisa esto\n📎 [doc.pdf](https://x/doc.pdf)";
    const { body, attachments } = parseComment(content);
    expect(body).toBe("Revisa esto");
    expect(attachments).toEqual([{ name: "doc.pdf", url: "https://x/doc.pdf" }]);
  });

  it("recompone los adjuntos con attachmentsToLines", () => {
    const atts = [{ name: "a.png", url: "https://x/a.png" }];
    expect(attachmentsToLines(atts)).toBe("📎 [a.png](https://x/a.png)");
  });
});

describe("combineBodyAndAttachments", () => {
  const atts = [{ name: "x.pdf", url: "https://x/x.pdf" }];
  it("une cuerpo y adjuntos", () => {
    expect(combineBodyAndAttachments("<p>hola</p>", atts)).toBe("<p>hola</p>\n📎 [x.pdf](https://x/x.pdf)");
  });
  it("con cuerpo vacío devuelve solo los adjuntos", () => {
    expect(combineBodyAndAttachments("", atts)).toBe("📎 [x.pdf](https://x/x.pdf)");
  });
  it("sin adjuntos devuelve el cuerpo", () => {
    expect(combineBodyAndAttachments("<p>hola</p>", [])).toBe("<p>hola</p>");
  });
});

describe("isRichHtml", () => {
  it("detecta HTML enriquecido (empieza con bloque)", () => {
    expect(isRichHtml("<p>hola <strong>mundo</strong></p>")).toBe(true);
  });
  it("detecta menciones", () => {
    expect(isRichHtml('<span data-type="mention" data-id="u1">@x</span>')).toBe(true);
  });
  it("no marca texto plano como HTML", () => {
    expect(isRichHtml("hola @Habib, revisa esto (3 < 4)")).toBe(false);
  });
  it("no confunde texto plano con etiquetas sueltas", () => {
    expect(isRichHtml("usa <b> para negritas")).toBe(false);
    expect(isRichHtml("contactar <a@b.com>")).toBe(false);
  });
});

describe("plainTextToEditableHtml", () => {
  const profiles = [{ user_id: "u-habib", full_name: "Habib Fernando" }];
  it("envuelve la @mención conocida en un nodo de mención", () => {
    const html = plainTextToEditableHtml("hola @Habib Fernando revisa", profiles);
    expect(html).toContain('data-type="mention"');
    expect(html).toContain('data-id="u-habib"');
    expect(html.startsWith("<p>")).toBe(true);
  });
  it("escapa HTML del texto plano", () => {
    expect(plainTextToEditableHtml("a < b & c", profiles)).toContain("&lt;");
  });
  it("deja el texto tal cual si la mención no está en el directorio", () => {
    const html = plainTextToEditableHtml("hola @Nadie", profiles);
    expect(html).not.toContain('data-type="mention"');
    expect(html).toContain("@Nadie");
  });
});

describe("sanitizeCommentHtml", () => {
  it("elimina scripts y conserva formato + menciones", () => {
    const dirty =
      '<p>Hola <strong>mundo</strong> <span data-type="mention" data-id="u1" class="mention">@Habib</span></p><script>alert(1)</script>';
    const clean = sanitizeCommentHtml(dirty);
    expect(clean).toContain("<strong>mundo</strong>");
    expect(clean).toContain('data-id="u1"');
    expect(clean).not.toContain("<script");
  });

  it("neutraliza enlaces con javascript:", () => {
    const clean = sanitizeCommentHtml('<a href="javascript:alert(1)">x</a>');
    expect(clean).not.toContain("javascript:");
  });
});

describe("richTextIsEmpty", () => {
  it("trata <p></p> como vacío", () => {
    expect(richTextIsEmpty("<p></p>")).toBe(true);
  });
  it("una mención cuenta como contenido", () => {
    expect(
      richTextIsEmpty('<p><span data-type="mention" data-id="u1">@Habib</span></p>'),
    ).toBe(false);
  });
  it("texto real no está vacío", () => {
    expect(richTextIsEmpty("<p>hola</p>")).toBe(false);
  });
});

describe("commentPlainText", () => {
  it("quita HTML y adjuntos para vista previa", () => {
    const content =
      '<p>Hola <strong>equipo</strong></p><p>segundo</p>\n📎 [x.pdf](https://x/x.pdf)';
    expect(commentPlainText(content)).toBe("Hola equipo segundo");
  });
  it("devuelve texto plano heredado tal cual", () => {
    expect(commentPlainText("solo texto @Habib")).toBe("solo texto @Habib");
  });
});
