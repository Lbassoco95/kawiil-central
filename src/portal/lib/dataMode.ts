/**
 * Fase 1: la UI consume representación local ya publicada en OS, o fixtures demo.
 * Nunca implica pulls a SAT/Moffin/SatGo desde el navegador.
 *
 * Fixtures sintéticos (hoteles Tulum / Aldea del Sol) solo en `/diseno`.
 * `VITE_PORTAL_DEMO_MODE` controla banner/marca DEMO, no la fuente de datos:
 * con sesión autenticada siempre se lee el espejo (`tablero.consultar` / `facturas.listar`).
 */
import { isDesignPreview } from "./designPreview";

/** Solo la vista de diseño sin sesión usa sampleData. Login real → espejo publicado. */
export function shouldUseDemoFixtures(): boolean {
  return isDesignPreview();
}
