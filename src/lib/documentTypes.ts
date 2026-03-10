/**
 * Tipos de archivo aceptados para subir documentos / minutas.
 * Incluye formatos que se pueden leer para análisis y propuesta de tareas:
 * PDF, Word, texto plano (TXT, CSV, MD), Office (Excel, PowerPoint), imágenes.
 */
export const ACCEPTED_DOCUMENT_EXTENSIONS =
  ".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,image/*";

/** MIME types habituales para los mismos formatos (para validación opcional) */
export const ACCEPTED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
