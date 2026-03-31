/**
 * Extracción de PDF en el navegador (sin límites de CPU de Edge).
 * Misma estrategia que MeetingMinutesDialog: unpdf y pdfjs-dist como respaldo.
 */
export async function extractPdfPagesClient(file: File): Promise<{ totalPages: number; pages: string[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text.map((t) => String(t ?? "")) : [String(text ?? "")];
    const n = totalPages && totalPages > 0 ? totalPages : pages.length;
    return { totalPages: n, pages: pages.length >= n ? pages.slice(0, n) : pages };
  } catch {
    const pdfjsLib = await import("pdfjs-dist");
    const pdfjs = pdfjsLib.default ?? pdfjsLib;
    (pdfjs as { disableWorker?: boolean }).disableWorker = true;
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const t = textContent.items.map((item: { str?: string }) => item.str ?? "").join(" ");
      pages.push(t);
    }
    return { totalPages: doc.numPages, pages };
  }
}
