/** Modo demostración del espejo del servicio Kawiil (Corte 4). La marca fiscal aplica a CFDI sintéticos. */
export const DEMO_FISCAL_MARK = "DEMO — sin validez fiscal";

export function isPortalDemoMode(): boolean {
  return String(import.meta.env.VITE_PORTAL_DEMO_MODE ?? "").trim().toLowerCase() === "true";
}
