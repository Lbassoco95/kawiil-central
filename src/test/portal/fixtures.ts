/** CFDI 4.0 sintético (datos inventados, sello de relleno). */
export function cfdiXml(over: Partial<Record<string, string>> = {}): string {
  const v = {
    uuid: "6F8A1B2C-3D4E-4F50-8A6B-7C8D9E0F1A2B",
    emisor: "EKU9003173C9",
    receptor: "AAA010101AAA",
    total: "1160.00",
    forma: "01",
    ...over,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="A" Folio="10" Fecha="2026-09-15T10:00:00" Sello="SELLODEPRUEBA" NoCertificado="30001000000500003416"
  Certificado="MIIF" SubTotal="1000.00" Moneda="MXN" Total="${v.total}" TipoDeComprobante="I" Exportacion="01"
  MetodoPago="PUE" FormaPago="${v.forma}" LugarExpedicion="01000">
  <cfdi:Emisor Rfc="${v.emisor}" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${v.receptor}" Nombre="CLIENTE SINTETICO A" DomicilioFiscalReceptor="01000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="15101514" Cantidad="1" ClaveUnidad="LTR" Descripcion="Gasolina &amp; aditivo" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="999.00"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00">
    <cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${v.uuid}" FechaTimbrado="2026-09-15T10:01:00" RfcProvCertif="SAT970701NN3" SelloCFD="X" NoCertificadoSAT="00001000000505142236" SelloSAT="SELLOSAT"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}
