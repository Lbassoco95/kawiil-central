/**
 * Extracción de texto de .docx en el navegador (mammoth),
 * análoga a `extractPdfTextClient` para PDFs.
 */
export async function extractDocxTextClient(file: File): Promise<string | null> {
  try {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = (result.value || "").replace(/\r\n/g, "\n").trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    console.warn("extractDocxTextClient", file.name, e);
    return null;
  }
}

export function isDocxChatAttachment(name: string, mimeType?: string | null): boolean {
  const n = name.toLowerCase();
  const mt = (mimeType || "").toLowerCase();
  return mt.includes("wordprocessingml") || n.endsWith(".docx");
}
