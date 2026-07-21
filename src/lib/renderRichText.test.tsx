import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { friendlyUrlLabel, renderRichText } from "./renderRichText";

describe("friendlyUrlLabel", () => {
  it("usa el nombre de archivo y oculta el token de una URL firmada de Supabase", () => {
    const url =
      "https://proj.supabase.co/storage/v1/object/sign/documents/comment-attachments/1712345678901_captura.png?token=eyJhbGciOiJ.abc.def";
    expect(friendlyUrlLabel(url)).toBe("captura.png");
  });

  it("decodifica el nombre y respeta espacios", () => {
    const url =
      "https://proj.supabase.co/storage/v1/object/sign/documents/1712345678901_Captura%20de%20pantalla.png?token=xyz";
    expect(friendlyUrlLabel(url)).toBe("Captura de pantalla.png");
  });

  it("deriva el nombre de un enlace de Dropbox", () => {
    expect(
      friendlyUrlLabel("https://www.dropbox.com/scl/fi/abc123/informe.pdf?rlkey=zzz"),
    ).toBe("informe.pdf");
  });
});

describe("renderRichText", () => {
  it("renderiza un adjunto markdown como enlace sin filtrar el token", () => {
    const html = renderToStaticMarkup(
      <>{renderRichText("Revisa 📎 [captura.png](https://x.co/f.png?token=eyJsecret) aquí", "t")}</>,
    );
    expect(html).toContain('href="https://x.co/f.png?token=eyJsecret"');
    expect(html).toContain("captura.png");
    // El token no debe aparecer como texto visible.
    expect(html).not.toContain(">eyJsecret<");
  });

  it("convierte **texto** en negrita", () => {
    const html = renderToStaticMarkup(<>{renderRichText("**Plazo:** 10 días", "t")}</>);
    expect(html).toContain("<strong");
    expect(html).toContain("Plazo:");
    expect(html).not.toContain("**");
  });

  it("convierte una URL pelada en enlace con nombre legible", () => {
    const html = renderToStaticMarkup(
      <>{renderRichText("archivo: https://proj.supabase.co/a/1712345678901_doc.pdf?token=abc", "t")}</>,
    );
    expect(html).toContain('href="https://proj.supabase.co/a/1712345678901_doc.pdf?token=abc"');
    expect(html).toContain("doc.pdf");
  });
});
