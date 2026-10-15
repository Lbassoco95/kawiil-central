/** Tamaño máximo de archivo que se precarga al pasar el cursor (más allá solo se carga al abrir). */
export const PREFETCH_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Caché de descargas en curso/terminadas por clave: abrir un documento que ya se precargó es
 * instantáneo y dos peticiones iguales comparten una sola descarga. Si falla, se olvida
 * para poder reintentar.
 */
export function createBlobCache() {
  const map = new Map<string, Promise<Blob>>();
  return {
    get(key: string, loader: () => Promise<Blob>): Promise<Blob> {
      let p = map.get(key);
      if (!p) {
        p = loader().catch((e) => {
          map.delete(key);
          throw e;
        });
        map.set(key, p);
      }
      return p;
    },
    clear() {
      map.clear();
    },
  };
}

/** Carga con antelación el visor pesado que hará falta para este archivo (Word / hojas de cálculo). */
export function preloadViewerFor(name: string): void {
  const n = name.trim().toLowerCase();
  if (n.endsWith(".docx")) void import("mammoth");
  else if (/\.(xlsx|xlsm|xls|csv|tsv)$/.test(n)) void import("@/lib/emailAttachmentSheetPreview");
}
