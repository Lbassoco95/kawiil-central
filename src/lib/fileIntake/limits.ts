/**
 * Presets de limites compartidos para FileDropzone / useFileIntake.
 * Cada modulo elige el preset que mejor le aplique (o pasa overrides).
 */

import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/documentTypes";

export type ZipMode = "expand" | "keep" | "auto";

export interface FileIntakeLimits {
  /** Cantidad maxima de archivos acumulados a la vez. */
  maxFiles: number;
  /** Tamano maximo por archivo individual (bytes). */
  maxBytesPerFile: number;
  /** Suma maxima de todos los archivos (bytes). */
  maxBatchBytes: number;
  /** Lista de extensiones/MIMEs aceptados (formato de input accept). undefined = todos. */
  accept?: string;
  /**
   * Como tratar ZIPs cuando el usuario los suelta:
   * - expand: siempre expandir
   * - keep: nunca expandir (se sube el ZIP tal cual)
   * - auto: expandir si pesa <= clientUnzipMaxBytes, si no usar Edge
   */
  zipMode: ZipMode;
  /** Umbral para descomprimir en cliente (bytes) cuando zipMode='auto'. */
  clientUnzipMaxBytes: number;
  /**
   * Si hay mas entradas que este numero, no se expande en el navegador (ZIP marcado para servidor).
   * Tambien aplica al modo no-defer: se usa unzip-batch en Edge en su lugar.
   */
  maxZipEntriesForClientExpand: number;
  /**
   * true: ZIP grande (peso en modo auto) o con demasiadas entradas se mantiene como un solo archivo
   * y se marca para `process-zip-documents` tras subir a Storage (Base documental / proyectos).
   * false: comportamiento anterior (Edge unzip-batch devuelve archivos sueltos), p. ej. chat adjuntos.
   */
  deferLargeZipToServer: boolean;
}

const MB = 1024 * 1024;

/** Preset usado por el chat IA (alineado con el modelo y Storage). */
export const chatLimits: FileIntakeLimits = {
  maxFiles: 20,
  maxBytesPerFile: 20 * MB,
  maxBatchBytes: 100 * MB,
  zipMode: "expand",
  clientUnzipMaxBytes: 25 * MB,
  maxZipEntriesForClientExpand: 150,
  deferLargeZipToServer: false,
};

/** Preset para subida de documentos en proyectos / KnowledgePanel. */
export const documentsLimits: FileIntakeLimits = {
  maxFiles: 50,
  maxBytesPerFile: 50 * MB,
  maxBatchBytes: 500 * MB,
  /** Office completo (incl. .ppt/.pptx) + XML/JSON usados en facturación y datos. */
  accept: `${ACCEPTED_DOCUMENT_EXTENSIONS},.xml,.json`,
  zipMode: "auto",
  clientUnzipMaxBytes: 25 * MB,
  maxZipEntriesForClientExpand: 150,
  deferLargeZipToServer: true,
};

/** Preset para adjuntos de correo (Microsoft / pipeline). */
export const emailLimits: FileIntakeLimits = {
  maxFiles: 10,
  maxBytesPerFile: 10 * MB,
  maxBatchBytes: 25 * MB,
  zipMode: "keep",
  clientUnzipMaxBytes: 25 * MB,
  maxZipEntriesForClientExpand: 150,
  deferLargeZipToServer: false,
};

/** Preset para comprobantes de gastos (XML, PDF, imagenes). */
export const expensesLimits: FileIntakeLimits = {
  maxFiles: 20,
  maxBytesPerFile: 15 * MB,
  maxBatchBytes: 80 * MB,
  accept: ".pdf,.xml,.png,.jpg,.jpeg,.zip",
  zipMode: "expand",
  clientUnzipMaxBytes: 25 * MB,
  maxZipEntriesForClientExpand: 150,
  deferLargeZipToServer: true,
};

/** Preset generico (tareas, comentarios, hub, etc.). */
export const genericLimits: FileIntakeLimits = {
  maxFiles: 30,
  maxBytesPerFile: 30 * MB,
  maxBatchBytes: 150 * MB,
  zipMode: "expand",
  clientUnzipMaxBytes: 25 * MB,
  maxZipEntriesForClientExpand: 150,
  deferLargeZipToServer: true,
};

/** Preset minimo para casos donde solo se permite un archivo (Hub procedimiento). */
export const singleFileLimits: FileIntakeLimits = {
  maxFiles: 1,
  maxBytesPerFile: 50 * MB,
  maxBatchBytes: 50 * MB,
  zipMode: "keep",
  clientUnzipMaxBytes: 25 * MB,
  maxZipEntriesForClientExpand: 150,
  deferLargeZipToServer: false,
};

export function formatMb(bytes: number): string {
  return (bytes / MB).toFixed(0);
}

/** Combina un preset con overrides parciales. */
export function withLimits(
  base: FileIntakeLimits,
  overrides: Partial<FileIntakeLimits>
): FileIntakeLimits {
  return { ...base, ...overrides };
}
