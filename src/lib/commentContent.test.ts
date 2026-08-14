import { describe, expect, it } from "vitest";
import {
  parseComment,
  attachmentsToLines,
  isRichHtml,
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

describe("isRichHtml", () => {
  it("detecta HTML enriquecido", () => {
    expect(isRichHtml("<p>hola <strong>mundo</strong></p>")).toBe(true);
  });
  it("no marca texto plano como HTML", () => {
    expect(isRichHtml("hola @Habib, revisa esto (3 < 4)")).toBe(false);
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
