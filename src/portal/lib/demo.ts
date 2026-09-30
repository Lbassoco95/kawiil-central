/** Modo demostración del espejo fiscal (Corte 4). Sin validez fiscal. */
export const DEMO_FISCAL_MARK = "DEMO — sin validez fiscal";

export function isPortalDemoMode(): boolean {
  return String(import.meta.env.VITE_PORTAL_DEMO_MODE ?? "").trim().toLowerCase() === "true";
}
