import { supabase } from "@/integrations/supabase/client";

const CV_BUCKET = "cv";

export interface CvImage {
  base64: string;
  mime: string;
}

function base64FromBytes(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function downloadCv(path: string): Promise<{ buf: Uint8Array; ext: string } | null> {
  const { data: signed } = await supabase.storage.from(CV_BUCKET).createSignedUrl(path, 60 * 5);
  if (!signed?.signedUrl) return null;
  const resp = await fetch(signed.signedUrl);
  if (!resp.ok) return null;
  const buf = new Uint8Array(await resp.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return { buf, ext };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPdfjs(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerMod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
  }
  return pdfjs;
}

/**
 * Descarga el CV y devuelve sus primeras `maxPages` páginas como imágenes JPEG base64.
 * - Si el CV ya es imagen (jpg/png/webp), la usa tal cual.
 * - Si es PDF, renderiza las páginas con pdf.js (en el navegador).
 * Rasterizar en el cliente evita el error "PDF not valid" de la IA con PDFs atípicos.
 */
export async function renderCvToImages(path: string, maxPages = 3): Promise<CvImage[]> {
  const dl = await downloadCv(path);
  if (!dl) return [];
  const { buf, ext } = dl;

  if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return [{ base64: base64FromBytes(buf), mime }];
  }

  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const n = Math.min(maxPages, doc.numPages);
    const out: CvImage[] = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const base64 = dataUrl.split(",")[1];
      if (base64) out.push({ base64, mime: "image/jpeg" });
    }
    return out;
  } catch (e) {
    console.error("renderCvToImages error:", e);
    return [];
  }
}

/**
 * Extrae el contenido del CV para la IA de forma robusta:
 *  - Imagen → se devuelve como imagen.
 *  - PDF → se extrae el TEXTO con unpdf (evita mandar el PDF crudo, que la IA a veces
 *    rechaza). Si casi no hay texto (CV escaneado), se rasteriza a imágenes.
 *  - Otro (p. ej. .docx) → sin texto ni imágenes (el llamador avisa al usuario).
 */
export async function extractCvContent(
  path: string,
  maxPages = 3,
): Promise<{ text: string; images: CvImage[] }> {
  const dl = await downloadCv(path);
  if (!dl) return { text: "", images: [] };
  const { buf, ext } = dl;

  if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { text: "", images: [{ base64: base64FromBytes(buf), mime }] };
  }

  if (ext === "pdf") {
    // 1) Texto con unpdf (proven en el resto de la app).
    let text = "";
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(buf);
      const res = await extractText(pdf, { mergePages: true });
      text = (Array.isArray(res.text) ? res.text.join("\n") : res.text ?? "").trim();
    } catch (e) {
      console.warn("unpdf extractText falló:", e);
    }
    if (text.length >= 40) return { text, images: [] };
    // 2) Poco/nada de texto → rasterizar (CV escaneado).
    return { text, images: await renderCvToImages(path, maxPages) };
  }

  return { text: "", images: [] };
}

/** Primera página del CV como imagen (para extraer la foto). */
export async function renderCvFirstPageToBase64(path: string): Promise<CvImage | null> {
  const dl = await downloadCv(path);
  if (!dl) return null;
  const { buf, ext } = dl;

  if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { base64: base64FromBytes(buf), mime };
  }

  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    return { base64: dataUrl.split(",")[1] ?? "", mime: "image/jpeg" };
  } catch (e) {
    console.error("renderCvFirstPageToBase64 error:", e);
    return null;
  }
}
