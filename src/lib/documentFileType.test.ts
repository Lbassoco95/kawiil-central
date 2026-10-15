import { describe, expect, it } from "vitest";
import { getFileType } from "./documentFileType";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("getFileType", () => {
  it("un .docx es Office aunque su mime contenga «xml»", () => {
    expect(getFileType("Denuncia.docx", DOCX)).toBe("office");
    expect(getFileType("Queja.docx", null)).toBe("office");
    expect(getFileType("Libro.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("office");
  });

  it("un XML real sigue siendo XML", () => {
    expect(getFileType("factura.xml", "application/xml")).toBe("xml");
    expect(getFileType("factura.xml", null)).toBe("xml");
  });

  it("PDF, imagen y texto", () => {
    expect(getFileType("a.pdf", "application/pdf")).toBe("pdf");
    expect(getFileType("a.png", "image/png")).toBe("image");
    expect(getFileType("a.txt", "text/plain")).toBe("text");
    expect(getFileType("a.bin", null)).toBe("unknown");
  });
});
