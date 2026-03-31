/** Límites compartidos: picker, useChat y mensajes al usuario. */
export const MAX_CHAT_ATTACHMENT_FILES = 20;
/** Tamaño máximo por archivo (bytes). Alineado con límites seguros del Edge ai-chat (PDF/Excel). */
export const MAX_CHAT_ATTACHMENT_BYTES_PER_FILE = 20 * 1024 * 1024;
/** Suma máxima de todos los adjuntos de un mensaje (bytes). */
export const MAX_CHAT_ATTACHMENT_BATCH_BYTES = 100 * 1024 * 1024;

export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}
