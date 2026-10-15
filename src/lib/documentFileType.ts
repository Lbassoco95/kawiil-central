export type PreviewFileType = "pdf" | "image" | "xml" | "text" | "office" | "unknown";

/** Tipo de vista previa de un archivo según extensión y mime. */
export function getFileType(name: string, mimeType?: string | null): PreviewFileType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType?.includes("pdf") || ext === "pdf") return "pdf";
  if (mimeType?.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  // Office primero: el mime de .docx/.xlsx/.pptx contiene «xml» («...officedocument.wordprocessingml...»).
  if (["xlsx", "xls", "docx", "doc", "pptx", "ppt"].includes(ext) ||
      mimeType?.includes("officedocument") || mimeType?.includes("msword") ||
      mimeType?.includes("spreadsheet") || mimeType?.includes("presentation")) return "office";
  if (ext === "xml" || (mimeType?.includes("xml") && !ext)) return "xml";
  if (["txt", "csv", "md", "log"].includes(ext) || mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "text/markdown") return "text";
  if (mimeType?.includes("xml")) return "xml";
  if (mimeType?.includes("document")) return "office";
  return "unknown";
}
