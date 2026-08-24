import { describe, expect, it } from "vitest";
import {
  attachmentPreviewKind,
  attachmentPreviewKindLabel,
  effectiveAttachmentMime,
} from "./attachmentPreviewKind";

describe("attachmentPreviewKind", () => {
  it("reconoce PDF por tipo y por extensión", () => {
    expect(attachmentPreviewKind("Presentación Softlanding.pdf", "application/pdf")).toBe("pdf");
    expect(attachmentPreviewKind("Presentación Softlanding.pdf", "application/octet-stream")).toBe("pdf");
  });

  it("reconoce imágenes, Word, hojas de cálculo y texto", () => {
    expect(attachmentPreviewKind("firma.PNG", null)).toBe("image");
    expect(attachmentPreviewKind("contrato.docx", "application/octet-stream")).toBe("docx");
    expect(attachmentPreviewKind("cotizacion.xlsx", null)).toBe("sheet");
    expect(attachmentPreviewKind("padron.csv", "text/csv")).toBe("sheet");
    expect(attachmentPreviewKind("notas.txt", null)).toBe("text");
  });

  it("marca como `other` lo que el navegador no puede pintar", () => {
    expect(attachmentPreviewKind("expediente.zip", "application/zip")).toBe("other");
    expect(attachmentPreviewKind("sin-extension", "application/octet-stream")).toBe("other");
  });

  it("prefiere el tipo declarado cuando es útil", () => {
    expect(effectiveAttachmentMime("archivo.bin", "application/pdf")).toBe("application/pdf");
    expect(effectiveAttachmentMime("archivo.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(effectiveAttachmentMime("archivo.bin", null)).toBe("");
  });

  it("etiqueta cada tipo en español", () => {
    expect(attachmentPreviewKindLabel("sheet")).toBe("Hoja de cálculo");
    expect(attachmentPreviewKindLabel("other")).toBe("Archivo");
  });
});
