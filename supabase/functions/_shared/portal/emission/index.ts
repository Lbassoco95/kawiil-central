import { EmisorPrueba } from "./emisorPrueba.ts";
import { EmisorPacPlantilla } from "./emisorPacPlantilla.ts";
import { EmisorFacturapi } from "./emisorFacturapi.ts";
import type { EmisorCfdi } from "./types.ts";

export * from "./types.ts";
export { validarBorrador, calcularTotales } from "./validar.ts";
export { EmisorPrueba, EmisorPacPlantilla, EmisorFacturapi };
export {
  borradorToFacturapiIngreso,
} from "./emisorFacturapi.ts";
export {
  createInvoice,
  paymentSummary,
  facturapiConfigFromEnv,
  FacturapiError,
} from "./facturapiClient.ts";

/**
 * PORTAL_EMISOR:
 * - facturapi → timbra con Facturapi (FACTURAPI_SECRET_KEY)
 * - pac → plantilla (se niega hasta conectar PAC propio)
 * - otro / vacío → EmisorPrueba (sin validez fiscal)
 */
export function crearEmisor(portalEmisor: string | undefined | null): EmisorCfdi {
  const mode = (portalEmisor ?? "").trim().toLowerCase();
  if (mode === "facturapi") return new EmisorFacturapi();
  if (mode === "pac") return new EmisorPacPlantilla();
  return new EmisorPrueba();
}
