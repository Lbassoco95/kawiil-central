import { describe, it, expect } from "vitest";
import { parseCfdiXml } from "../../../supabase/functions/_shared/portal/cfdiXml.ts";
import {
  enrichFromXml,
  enrichSatgoComprobante,
  toPublishedInvoice,
} from "../../../supabase/functions/_shared/satgoCfdiEnrich.ts";
import { extractXmlFromSatgoComprobante } from "../../../supabase/functions/_shared/satgoFielClient.ts";
import { cfdiXml } from "./fixtures";

function paymentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Fecha="2026-09-20T12:00:00" Sello="SELLO" NoCertificado="30001000000500003416"
  Certificado="MIIF" SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P" Exportacion="01" LugarExpedicion="01000">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="EMISOR" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="BVS211101H55" Nombre="BASSOCO" DomicilioFiscalReceptor="01000" RegimenFiscalReceptor="601" UsoCFDI="CP01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Pago FechaPago="2026-09-20T12:00:00" FormaDePagoP="03" MonedaP="MXN" Monto="5800.00">
        <pago20:DoctoRelacionado IdDocumento="AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA" MonedaDR="MXN" NumParcialidad="1" ImpSaldoAnt="5800.00" ImpPagado="5800.00" ImpSaldoInsoluto="0.00"/>
      </pago20:Pago>
    </pago20:Pagos>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="BBBBBBBB-2222-4222-8222-BBBBBBBBBBBB" FechaTimbrado="2026-09-20T12:01:00" RfcProvCertif="SAT970701NN3" SelloCFD="X" NoCertificadoSAT="00001000000505142236" SelloSAT="SELLOSAT"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

function creditNoteXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Fecha="2026-09-18T09:00:00" Sello="SELLO" NoCertificado="30001000000500003416"
  Certificado="MIIF" SubTotal="1000.00" Moneda="MXN" Total="1160.00" TipoDeComprobante="E" Exportacion="01"
  MetodoPago="PUE" FormaPago="17" LugarExpedicion="01000">
  <cfdi:CfdiRelacionados TipoRelacion="01">
    <cfdi:CfdiRelacionado UUID="CCCCCCCC-3333-4333-8333-CCCCCCCCCCCC"/>
  </cfdi:CfdiRelacionados>
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="EMISOR" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="BVS211101H55" Nombre="BASSOCO" DomicilioFiscalReceptor="01000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="80101500" Cantidad="1" ClaveUnidad="E48" Descripcion="Descuento consultoria" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00">
    <cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="DDDDDDDD-4444-4444-8444-DDDDDDDDDDDD" FechaTimbrado="2026-09-18T09:01:00" RfcProvCertif="SAT970701NN3" SelloCFD="X" NoCertificadoSAT="00001000000505142236" SelloSAT="SELLOSAT"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

describe("satgo CFDI enrich", () => {
  it("marca complete con monto+PUE+partidas desde XML", () => {
    const e = enrichFromXml(cfdiXml({ total: "11600.00" }))!;
    expect(e.detailStatus).toBe("complete");
    expect(e.total).toBe(11600);
    expect(e.paymentMethod).toBe("PUE");
    expect(e.concepts[0].product_service_key).toBe("15101514");
    expect(e.sourceXml).toBe(true);
    const pub = toPublishedInvoice(e, "recibida");
    expect(pub.detail_status).toBe("complete");
    expect(pub.concepts?.[0].product_service_key).toBe("15101514");
  });

  it("extrae complemento de pago (DoctoRelacionado)", () => {
    const p = parseCfdiXml(paymentXml())!;
    expect(p.tipoComprobante).toBe("P");
    expect(p.payments).toHaveLength(1);
    expect(p.payments[0].relatedUuid).toBe("AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA");
    expect(p.payments[0].paidAmount).toBe(5800);
    const e = enrichFromXml(paymentXml())!;
    expect(e.payments[0].related_uuid).toBe("AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA");
  });

  it("extrae NC con CfdiRelacionado y flag nota_credito", () => {
    const e = enrichFromXml(creditNoteXml())!;
    expect(e.voucherType).toBe("E");
    expect(e.relatedUuid).toBe("CCCCCCCC-3333-4333-8333-CCCCCCCCCCCC");
    expect(e.flags[0]).toMatchObject({ code: "nota_credito" });
  });

  it("lee XML embebido base64 en respuesta facfiel", () => {
    const xml = cfdiXml();
    const b64 = Buffer.from(xml, "utf8").toString("base64");
    const extracted = extractXmlFromSatgoComprobante({ uuid: "X", xmlBase64: b64 });
    expect(extracted).toContain("Comprobante");
    const e = enrichSatgoComprobante(
      { uuid: "6F8A1B2C-3D4E-4F50-8A6B-7C8D9E0F1A2B", xmlBase64: b64, total: 0 },
      "6F8A1B2C-3D4E-4F50-8A6B-7C8D9E0F1A2B",
    );
    expect(e.detailStatus).toBe("complete");
    expect(e.total).toBe(1160);
  });

  it("sin XML queda metadata aunque haya nombre", () => {
    const e = enrichSatgoComprobante(
      {
        uuid: "4DD7BE4B-BE0E-11F1-B391-51D238E42B13",
        razonSocialEmisor: "GOOGLE CLOUD MEXICO",
        total: null as unknown as number,
      },
      "4DD7BE4B-BE0E-11F1-B391-51D238E42B13",
    );
    expect(e.detailStatus).toBe("metadata");
    expect(e.total).toBe(0);
    expect(e.issuerName).toBe("GOOGLE CLOUD MEXICO");
    expect(e.sourceXml).toBe(false);
  });
});
