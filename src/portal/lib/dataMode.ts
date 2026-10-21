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

/**
 * Sesión autenticada: nunca mostrar fixtures `is_test` / «Mostrar ejemplos aparte».
 * Default: ocultos. Opt-out solo con `VITE_PORTAL_HIDE_DIDACTIC=false`.
 */
export function shouldHideDidacticFixtures(): boolean {
  const raw = String(import.meta.env.VITE_PORTAL_HIDE_DIDACTIC ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}
