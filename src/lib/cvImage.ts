import { supabase } from "@/integrations/supabase/client";

const CV_BUCKET = "cv";

function base64FromBytes(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Descarga el CV y devuelve su primera página como imagen base64 (PNG).
 * - Si el CV ya es imagen (jpg/png/webp), la usa tal cual.
 * - Si es PDF, renderiza la primera página con pdf.js (en el navegador).
 * Devuelve null si no se pudo procesar.
 */
export async function renderCvFirstPageToBase64(
  path: string,
): Promise<{ base64: string; mime: string } | null> {
  const { data: signed } = await supabase.storage.from(CV_BUCKET).createSignedUrl(path, 60 * 5);
  if (!signed?.signedUrl) return null;

  const resp = await fetch(signed.signedUrl);
  if (!resp.ok) return null;
  const buf = new Uint8Array(await resp.arrayBuffer());

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { base64: base64FromBytes(buf), mime };
  }

  // PDF → renderizar la primera página a un canvas y exportar PNG.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import("pdfjs-dist");
    // Configura el worker (patrón Vite) — sin esto el render sale en blanco.
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      const workerMod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
    }
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Fondo blanco (los PDFs suelen ser transparentes; evita render "negro").
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
