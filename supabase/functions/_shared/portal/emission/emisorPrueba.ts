/**
 * EmisorPrueba: valida igual que el real y devuelve un XML marcado
 * «SIN VALIDEZ FISCAL». No timbra, no firma, no toca la llave del CSD y no
 * habla con ningún PAC ni con el SAT.
 */
import { validarBorrador } from "./validar.ts";
import { EmisionRechazada, type BorradorFactura, type ContextoEmision, type EmisorCfdi, type EstadoCfdi, type ResultadoEmision, type ResultadoValidacion } from "./types.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class EmisorPrueba implements EmisorCfdi {
  readonly nombre = "prueba" as const;

  async validar(b: BorradorFactura, ctx: ContextoEmision): Promise<ResultadoValidacion> {
    return validarBorrador(b, ctx);
  }

  async emitir(b: BorradorFactura, ctx: ContextoEmision): Promise<ResultadoEmision> {
    const v = validarBorrador(b, ctx);
    if (!v.ok) throw new EmisionRechazada(v.errores);
    const uuid = crypto.randomUUID().toUpperCase();
    const fecha = (ctx.ahora ?? new Date()).toISOString().slice(0, 19);
    const conceptos = b.conceptos
      .map((c) => `    <prueba:Concepto ClaveProdServ="${esc(c.claveProdServ)}" ClaveUnidad="${esc(c.claveUnidad)}" Cantidad="${c.cantidad}" ValorUnitario="${c.valorUnitario}" Descripcion="${esc(c.descripcion)}" ObjetoImp="${c.objetoImp}"/>`)
      .join("\n");
    // Espacio de nombres propio: este XML NO es un CFDI y no pasa como tal.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIN VALIDEZ FISCAL · EMISOR DE PRUEBA DE KAWIIL OS · NO TIMBRADO -->
<prueba:ComprobantePrueba xmlns:prueba="urn:kawiil:portal:emisor-prueba" Leyenda="SIN VALIDEZ FISCAL" UUIDPrueba="${uuid}" Fecha="${fecha}" TipoDeComprobante="I" Moneda="MXN" FormaPago="${esc(b.formaPago)}" MetodoPago="${b.metodoPago}" SubTotal="${v.totales.subtotal.toFixed(2)}" Total="${v.totales.total.toFixed(2)}">
  <prueba:Emisor Rfc="${esc(b.emisor.rfc)}" Nombre="${esc(b.emisor.nombre)}" RegimenFiscal="${esc(b.emisor.regimen)}"/>
  <prueba:Receptor Rfc="${esc(b.receptor.rfc)}" Nombre="${esc(b.receptor.nombre)}" DomicilioFiscalReceptor="${esc(b.receptor.cp)}" RegimenFiscalReceptor="${esc(b.receptor.regimen)}" UsoCFDI="${esc(b.receptor.uso)}"/>
  <prueba:Conceptos>
${conceptos}
  </prueba:Conceptos>
</prueba:ComprobantePrueba>
`;
    return { uuid, xml, esPrueba: true, fechaTimbrado: fecha, totales: v.totales };
  }

  async consultarEstado(_uuid: string): Promise<EstadoCfdi> {
    return "prueba";
  }
}
