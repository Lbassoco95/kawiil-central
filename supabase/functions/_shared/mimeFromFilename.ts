/**
 * Inferir MIME desde el nombre de archivo (Edge / Deno). Mantener alineado con src/lib/mimeFromFilename.ts
 */
export function guessMimeFromFilename(name: string): string {
  const lower = name.trim().toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : lower;

  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip": "application/zip",
    ".msg": "application/vnd.ms-outlook",
    ".eml": "message/rfc822",
  };

  return map[ext] ?? "application/octet-stream";
}
