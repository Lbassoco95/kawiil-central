/** Recuadro de firma: coordenadas normalizadas 0..1, origen arriba-izquierda, page base 1. */
export interface SignField {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tamaño por defecto de un recuadro nuevo (≈ 165 × 60 pt en una hoja carta/A4). */
export const DEFAULT_FIELD = { w: 0.28, h: 0.07 };

export const SIGNER_COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#64748b"];

export function signerColor(signers: Array<{ key: string }>, key: string): string {
  const i = signers.findIndex((s) => s.key === key);
  return SIGNER_COLORS[(i < 0 ? 0 : i) % SIGNER_COLORS.length];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let pdfjsPromise: Promise<any> | null = null;

/** Carga pdfjs una sola vez, con su worker empaquetado por Vite. */
export function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs: any = await import("pdfjs-dist");
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        const workerMod: any = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
