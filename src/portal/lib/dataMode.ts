/**
 * Fase 1: la UI consume representación local ya publicada en OS, o fixtures demo.
 * Nunca implica pulls a SAT/Moffin/SatGo desde el navegador.
 */
import { isDesignPreview } from "./designPreview";
import { isPortalDemoMode } from "./demo";

/** `/diseno` o `VITE_PORTAL_DEMO_MODE=true` → fixtures sintéticos (equivalente al espejo). */
export function shouldUseDemoFixtures(): boolean {
  return isDesignPreview() || isPortalDemoMode();
}
