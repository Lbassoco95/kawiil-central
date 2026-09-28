import { EmisorPrueba } from "./emisorPrueba.ts";
import { EmisorPacPlantilla } from "./emisorPacPlantilla.ts";
import type { EmisorCfdi } from "./types.ts";

export * from "./types.ts";
export { validarBorrador, calcularTotales } from "./validar.ts";
export { EmisorPrueba, EmisorPacPlantilla };

/** PORTAL_EMISOR=pac elige la plantilla (que se niega a emitir). Cualquier otro valor: prueba. */
export function crearEmisor(portalEmisor: string | undefined | null): EmisorCfdi {
  return portalEmisor === "pac" ? new EmisorPacPlantilla() : new EmisorPrueba();
}
