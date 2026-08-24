import { describe, expect, it } from "vitest";
import {
  attachmentPreviewKind,
  attachmentPreviewKindLabel,
  decodeAttachmentText,
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

/** El Blob de jsdom no trae `arrayBuffer()`; basta con los bytes. */
function blobOf(bytes: Uint8Array): Blob {
  return { arrayBuffer: async () => bytes.buffer } as unknown as Blob;
}

describe("decodeAttachmentText", () => {
  it("lee UTF-8", async () => {
    const bytes = new TextEncoder().encode("Presentación Softlanding");
    await expect(decodeAttachmentText(blobOf(bytes))).resolves.toBe("Presentación Softlanding");
  });

  it("cae a Windows-1252 cuando el archivo no es UTF-8 válido", async () => {
    // «Presentación» en Windows-1252 (0xF3 = ó): secuencia inválida en UTF-8.
    const bytes = new Uint8Array([0x50, 0x72, 0x65, 0x73, 0x65, 0x6e, 0x74, 0x61, 0x63, 0x69, 0xf3, 0x6e]);
    await expect(decodeAttachmentText(blobOf(bytes))).resolves.toBe("Presentación");
  });
});
