import { chatLimits, formatMb as formatMbShared } from "@/lib/fileIntake/limits";

/**
 * Limites para adjuntos del chat IA.
 * Delegado a `@/lib/fileIntake/limits` para mantener un solo origen de verdad.
 */
export const MAX_CHAT_ATTACHMENT_FILES = chatLimits.maxFiles;
export const MAX_CHAT_ATTACHMENT_BYTES_PER_FILE = chatLimits.maxBytesPerFile;
export const MAX_CHAT_ATTACHMENT_BATCH_BYTES = chatLimits.maxBatchBytes;

/** Imagen para Claude en el Edge (base64): por encima suele acercarse al tope de 200k tokens de contexto. */
export const MAX_CHAT_IMAGE_BYTES_FOR_MODEL = 512 * 1024;

export const formatMb = formatMbShared;
