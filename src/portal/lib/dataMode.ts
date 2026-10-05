/**
 * Fase 1: la UI muestra datos de la cuenta ya listos en OS, o fixtures de diseño.
 * Nunca implica pulls a SAT/Moffin/SatGo desde el navegador.
 *
 * Fixtures sintéticos (hoteles Tulum / Aldea del Sol) solo en `/diseno`.
 * `VITE_PORTAL_DEMO_MODE` controla banner/marca DEMO, no la fuente de datos:
 * con sesión autenticada siempre se lee Facturación (`tablero.consultar` / `facturas.listar`).
 */
import { isDesignPreview } from "./designPreview";

/** Solo la vista de diseño sin sesión usa sampleData. Login real → CFDI de la cuenta. */
export function shouldUseDemoFixtures(): boolean {
  return isDesignPreview();
}
