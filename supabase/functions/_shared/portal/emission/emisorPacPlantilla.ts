/**
 * EmisorPacPlantilla: esqueleto para el emisor real. NO está conectado a
 * ningún PAC y `emitir` siempre lanza PacNoConfigurado. Kawiil entregará el
 * PAC (sección 9 del encargo); este archivo dice dónde va cada pieza.
 *
 * Pasos que debe implementar el emisor real, en la Edge (nunca en el navegador):
 *   1. Armar el XML CFDI 4.0 de ingreso desde el BorradorFactura validado.
 *   2. Generar la cadena original con el XSLT oficial del SAT.
 *   3. Leer el CSD: `client_sat_certificates` (cert_type = 'csd_sello') con
 *      service_role, descifrar .cer/.key con `decryptFielSecret` y la contraseña
 *      de `portal_csd_secrets` con PORTAL_CSD_SECRET. Solo en memoria, solo para
 *      sellar; no se registra en logs ni se devuelve. Cada uso → bitácora
 *      `csd_uso` (lo hace portal-api).
 *   4. Sellar (RSA-SHA256) y poner Sello, NoCertificado y Certificado.
 *   5. Mandar al PAC para timbrar; guardar XML timbrado y PDF en el bucket `portal`.
 *   6. `consultarEstado`: servicio de consulta del PAC o del SAT.
 * Variables previstas (no existen aún): PORTAL_PAC_URL, PORTAL_PAC_USER, PORTAL_PAC_PASSWORD.
 */
import { validarBorrador } from "./validar.ts";
import { PacNoConfigurado, type BorradorFactura, type ContextoEmision, type EmisorCfdi, type EstadoCfdi, type ResultadoEmision, type ResultadoValidacion } from "./types.ts";

export class EmisorPacPlantilla implements EmisorCfdi {
  readonly nombre = "pac" as const;

  async validar(b: BorradorFactura, ctx: ContextoEmision): Promise<ResultadoValidacion> {
    // El PAC real puede agregar validaciones propias aquí (p. ej. contra la lista LCO).
    return validarBorrador(b, ctx);
  }

  async emitir(_b: BorradorFactura, _ctx: ContextoEmision): Promise<ResultadoEmision> {
    throw new PacNoConfigurado();
  }

  async consultarEstado(_uuid: string): Promise<EstadoCfdi> {
    throw new PacNoConfigurado();
  }
}
