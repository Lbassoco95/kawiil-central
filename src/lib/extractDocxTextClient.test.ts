import { describe, expect, it } from "vitest";
import { isDocxChatAttachment } from "@/lib/extractDocxTextClient";

describe("isDocxChatAttachment", () => {
  it("detecta por extensión y MIME", () => {
    expect(isDocxChatAttachment("Convo Riesgo.docx", "application/octet-stream")).toBe(true);
    expect(
      isDocxChatAttachment(
        "x.bin",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(isDocxChatAttachment("informe.pdf", "application/pdf")).toBe(false);
    expect(isDocxChatAttachment("legado.doc", "application/msword")).toBe(false);
  });
});
