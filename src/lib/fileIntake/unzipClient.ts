import JSZip from "jszip";

export interface ExpandZipOptions {
  /** Si true, conserva la ruta relativa dentro del ZIP en `(file as any).__relativePath`. */
  preservePaths?: boolean;
  /** Tamano maximo total descomprimido en bytes (proteccion zip-bomb). Default 250 MB. */
  maxTotalUncompressedBytes?: number;
}

export interface ExpandZipResult {
  files: File[];
  warnings: string[];
}

const DEFAULT_MAX_TOTAL = 250 * 1024 * 1024;

function isJunkEntry(name: string): boolean {
  if (!name) return true;
  // Carpetas o entradas vacias.
  if (name.endsWith("/")) return true;
  // Basura de macOS / sistema.
  if (name.includes("__MACOSX")) return true;
  if (name.endsWith(".DS_Store")) return true;
  if (name.endsWith("Thumbs.db")) return true;
  // Path traversal.
  if (name.includes("..")) return true;
  if (name.startsWith("/")) return true;
  return false;
}

function basenameOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function guessMimeType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "txt":
    case "md":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "html":
    case "htm":
      return "text/html";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

/**
 * Expande un archivo ZIP en memoria a una lista de `File` planos.
 * Filtra entradas peligrosas y basura de SO. No descomprime ZIPs anidados.
 */
export async function expandZipInBrowser(
  zipFile: File,
  options: ExpandZipOptions = {}
): Promise<ExpandZipResult> {
  const preservePaths = options.preservePaths ?? false;
  const maxTotal = options.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL;

  const warnings: string[] = [];
  const out: File[] = [];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipFile);
  } catch (err) {
    throw new Error(
      `No se pudo abrir ${zipFile.name}: ${err instanceof Error ? err.message : "ZIP invalido"}`
    );
  }

  let totalBytes = 0;
  const entries = Object.values(zip.files);

  for (const entry of entries) {
    if (entry.dir) continue;
    if (isJunkEntry(entry.name)) continue;

    let blob: Blob;
    try {
      blob = await entry.async("blob");
    } catch (err) {
      warnings.push(
        `No se pudo extraer ${entry.name}: ${err instanceof Error ? err.message : "error"}`
      );
      continue;
    }

    totalBytes += blob.size;
    if (totalBytes > maxTotal) {
      warnings.push(
        `Se cancelo la extraccion: el contenido descomprimido supera ${(maxTotal / 1024 / 1024).toFixed(0)} MB`
      );
      break;
    }

    const name = basenameOf(entry.name);
    const mime = blob.type || guessMimeType(name);
    const file = new File([blob], name, {
      type: mime,
      lastModified: entry.date?.getTime() ?? Date.now(),
    });

    if (preservePaths) {
      try {
        Object.defineProperty(file, "__relativePath", {
          value: entry.name,
          enumerable: false,
          configurable: true,
        });
      } catch {
        // Ignorar si el ambiente no permite definir la propiedad.
      }
    }

    out.push(file);
  }

  return { files: out, warnings };
}

export function isZipFile(file: File): boolean {
  if (file.type === "application/zip" || file.type === "application/x-zip-compressed") {
    return true;
  }
  return file.name.toLowerCase().endsWith(".zip");
}
