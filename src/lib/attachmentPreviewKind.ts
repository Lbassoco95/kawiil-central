import { inferMimeFromFileName } from "@/lib/outlookEmailMedia";

/**
 * Cómo se puede previsualizar un adjunto dentro de Kawiil.
 *
 * `other` = sin vista previa en el navegador; sólo queda descargarlo.
 */
export type AttachmentPreviewKind = "image" | "pdf" | "docx" | "sheet" | "text" | "other";

/**
 * Tipo MIME confiable del adjunto.
 *
 * Outlook/Graph a veces manda `application/octet-stream`; en ese caso se
 * deduce del nombre del archivo (misma regla que el lector de correo).
 */
export function effectiveAttachmentMime(name: string, contentType?: string | null): string {
  const declared = (contentType || "").trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  return (inferMimeFromFileName(name || "") || declared || "").toLowerCase();
}

/** Clasifica el adjunto para elegir el visor (imagen, PDF, DOCX, tabla, texto). */
export function attachmentPreviewKind(name: string, contentType?: string | null): AttachmentPreviewKind {
  const mime = effectiveAttachmentMime(name, contentType);
  const n = (name || "").trim().toLowerCase();

  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|tiff?|avif)$/.test(n)) return "image";
  if (mime.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (mime.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  if (
    /\.(xlsx|xlsm|xls|csv|tsv)$/.test(n) ||
    mime.includes("spreadsheetml") ||
    mime.includes("spreadsheet") ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv" ||
    mime === "text/tab-separated-values" ||
    mime === "application/csv"
  ) {
    return "sheet";
  }
  if (
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime.includes("xml") ||
    mime === "application/json" ||
    /\.(txt|md|log|xml|json|ya?ml)$/.test(n)
  ) {
    return "text";
  }
  return "other";
}

/** Etiqueta corta para el encabezado de la vista previa. */
export function attachmentPreviewKindLabel(kind: AttachmentPreviewKind): string {
  switch (kind) {
    case "image":
      return "Imagen";
    case "pdf":
      return "PDF";
    case "docx":
      return "Word";
    case "sheet":
      return "Hoja de cálculo";
    case "text":
      return "Texto";
    default:
      return "Archivo";
  }
}
