/**
 * Límites de grabación / subida de juntas (hasta ~3 horas de audio).
 */

/** Duración máxima orientativa de una grabación de junta. */
export const MTG_MAX_RECORDING_HOURS = 3;

/**
 * Tope de Storage para un archivo de grabación.
 * 3 h de audio a ~128 kbps ≈ 170 MB; dejamos margen.
 */
export const MTG_MAX_RECORDING_BYTES = 200 * 1024 * 1024;

/** Límite por petición de OpenAI Whisper. */
export const MTG_WHISPER_MAX_BYTES = 24 * 1024 * 1024;

/** Tamaño de cada trozo al partir para Whisper (bajo el techo de 25 MB). */
export const MTG_WHISPER_CHUNK_BYTES = 20 * 1024 * 1024;

export function formatRecordingSizeMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1);
}

/**
 * Parte un archivo en trozos ≤ chunkBytes.
 * Para webm/mp4 se reutiliza un prefijo de cabecera en trozos siguientes
 * para que el contenedor siga siendo interpretable por Whisper.
 */
export function splitBytesForWhisper(
  bytes: Uint8Array,
  chunkBytes = MTG_WHISPER_CHUNK_BYTES,
  headerBytes = 64 * 1024,
): Uint8Array[] {
  if (bytes.byteLength === 0) return [];
  if (bytes.byteLength <= chunkBytes) return [bytes];

  const headerLen = Math.min(headerBytes, Math.floor(chunkBytes / 4), bytes.byteLength);
  const header = bytes.subarray(0, headerLen);
  const out: Uint8Array[] = [];

  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset === 0) {
      const end = Math.min(chunkBytes, bytes.byteLength);
      out.push(bytes.subarray(0, end));
      offset = end;
      continue;
    }
    const bodyBudget = chunkBytes - headerLen;
    const end = Math.min(offset + bodyBudget, bytes.byteLength);
    const body = bytes.subarray(offset, end);
    const merged = new Uint8Array(headerLen + body.byteLength);
    merged.set(header, 0);
    merged.set(body, headerLen);
    out.push(merged);
    offset = end;
  }
  return out;
}
