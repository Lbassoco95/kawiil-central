/**
 * Enriquece metadatos facfiel con parseo de XML CFDI (montos, PUE/PPD, partidas, pagos, NC).
 * Sin almacenamiento de XML/PDF ni material de firma — solo campos estructurados.
 */
import {
  parseCfdiXml,
  type CfdiParsed,
  type CfdiPaymentDoc,
} from "./portal/cfdiXml.ts";
import type {
  PublishedInvoice,
  PublishedInvoiceConcept,
  PublishedPaymentLink,
} from "./portal/fiscalMirror.ts";
import {
  extractXmlFromSatgoComprobante,
  pickSatgoAmount,
  type SatgoFacComprobante,
} from "./satgoFielClient.ts";

export type EnrichedCfdi = {
  uuid: string;
  detailStatus: "metadata" | "complete";
  issuedAt: string | null;
  issuerRfc: string | null;
  issuerName: string | null;
  receiverRfc: string | null;
  receiverName: string | null;
  voucherType: string | null;
  paymentMethod: string | null;
  paymentForm: string | null;
  currency: string;
  exchangeRate: number | null;
  subtotal: number;
  discount: number;
  vatTransferred: number;
  vatWithheld: number;
  incomeTaxWithheld: number;
  total: number;
  satStatus: string;
  version: string | null;
  concepts: PublishedInvoiceConcept[];
  payments: PublishedPaymentLink[];
  /** UUID de factura relacionada (NC / TipoRelacion). */
  relatedUuid: string | null;
  flags: Array<Record<string, unknown>>;
  sourceXml: boolean;
};

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function upperRfc(v: unknown): string | null {
  const s = str(v);
  return s ? s.toUpperCase().replace(/\s/g, "") : null;
}

function normalizeMetodo(m: string | null): string | null {
  if (!m) return null;
  const u = m.trim().toUpperCase();
  if (u === "PUE" || u === "PPD") return u;
  return u || null;
}

function fromParsed(p: CfdiParsed, listSatStatus: string): EnrichedCfdi {
  const uuid = (p.uuid ?? "").toUpperCase();
  const total = Number(p.total ?? 0);
  const paymentMethod = normalizeMetodo(p.metodoPago);
  const voucherType = p.tipoComprobante ?? null;
  const concepts: PublishedInvoiceConcept[] = p.conceptos.map((c) => ({
    product_service_key: c.claveProdServ,
    description: c.descripcion ?? "(sin descripción)",
    quantity: Number(c.cantidad ?? 1),
    unit_value: Number(c.valorUnitario ?? c.importe ?? 0),
    amount: Number(c.importe ?? 0),
    discount: Number(c.descuento ?? 0),
  }));
  const payments: PublishedPaymentLink[] = (p.payments ?? []).map((pay: CfdiPaymentDoc) => ({
    related_uuid: pay.relatedUuid,
    paid_at: pay.paidAt ?? p.fecha ?? new Date().toISOString(),
    paid_amount: Number(pay.paidAmount ?? 0),
  }));
  const relatedUuid = p.relations?.[0]?.relatedUuid ?? null;
  const flags: Array<Record<string, unknown>> = [];
  if (voucherType === "E" && relatedUuid) {
    flags.push({
      code: "nota_credito",
      reason: `Nota de crédito sobre ${relatedUuid}`,
      related_uuid: relatedUuid,
    });
  }
  const hasAmount = Number.isFinite(total) && Math.abs(total) > 0.009;
  const hasMethod = !!paymentMethod || voucherType === "P" || voucherType === "E";
  const detailStatus: "metadata" | "complete" =
    hasAmount && (hasMethod || concepts.length > 0) ? "complete" : "metadata";

  return {
    uuid,
    detailStatus,
    issuedAt: p.fecha ?? p.fechaTimbrado ?? null,
    issuerRfc: p.emisor.rfc,
    issuerName: p.emisor.nombre,
    receiverRfc: p.receptor.rfc,
    receiverName: p.receptor.nombre,
    voucherType,
    paymentMethod,
    paymentForm: p.formaPago,
    currency: p.moneda ?? "MXN",
    exchangeRate: p.tipoCambio,
    subtotal: Number(p.subtotal ?? 0),
    discount: Number(p.descuento ?? 0),
    vatTransferred: Number(p.ivaTrasladado ?? 0),
    vatWithheld: Number(p.ivaRetenido ?? 0),
    incomeTaxWithheld: Number(p.isrRetenido ?? 0),
    total: Number.isFinite(total) ? total : 0,
    satStatus: listSatStatus,
    version: p.version,
    concepts,
    payments,
    relatedUuid,
    flags,
    sourceXml: true,
  };
}

function fromListMeta(c: SatgoFacComprobante, uuid: string): EnrichedCfdi {
  const total =
    pickSatgoAmount(c, "total", "Total", "monto", "Monto", "importe", "Importe") ?? 0;
  const subtotal =
    pickSatgoAmount(c, "subtotal", "SubTotal", "subTotal") ?? 0;
  return {
    uuid,
    detailStatus: "metadata",
    issuedAt:
      str(c.fechaEmision) ?? str(c.fecha) ?? str(c.FechaEmision) ?? str(c.Fecha) ?? null,
    issuerRfc: upperRfc(c.rfcEmisor ?? c.RfcEmisor),
    issuerName: str(c.razonSocialEmisor ?? c.nombreEmisor ?? c.NombreEmisor),
    receiverRfc: upperRfc(c.rfcReceptor ?? c.RfcReceptor),
    receiverName: str(c.razonSocialReceptor ?? c.nombreReceptor ?? c.NombreReceptor),
    voucherType: str(c.tipoDeComprobante ?? c.TipoDeComprobante ?? c.efectoComprobante),
    paymentMethod: normalizeMetodo(str(c.metodoPago ?? c.MetodoPago)),
    paymentForm: str(c.formaPago ?? c.FormaPago),
    currency: str(c.moneda ?? c.Moneda) ?? "MXN",
    exchangeRate: pickSatgoAmount(c, "tipoCambio", "TipoCambio"),
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    discount: 0,
    vatTransferred: 0,
    vatWithheld: 0,
    incomeTaxWithheld: 0,
    total: Number.isFinite(total) ? total : 0,
    satStatus: String(
      c.estadoDeComprobante ?? c.estatus ?? c.estado ?? "unknown",
    ).slice(0, 40),
    version: null,
    concepts: [],
    payments: [],
    relatedUuid: null,
    flags: [],
    sourceXml: false,
  };
}

/** Combina listado SATgo + XML embebido (si viene) en un CFDI enriquecido. */
export function enrichSatgoComprobante(
  c: SatgoFacComprobante,
  uuidFallback: string,
): EnrichedCfdi {
  const uuid = String(c.uuid ?? c.UUID ?? c.folioFiscal ?? uuidFallback)
    .trim()
    .toUpperCase();
  const list = fromListMeta(c, uuid);
  const xml = extractXmlFromSatgoComprobante(c);
  if (!xml) return list;
  const parsed = parseCfdiXml(xml);
  if (!parsed) return list;
  const enriched = fromParsed(parsed, list.satStatus);
  // Preferir UUID del listado si el XML no trae timbre legible (raro).
  if (!enriched.uuid) enriched.uuid = uuid;
  // Conservar nombres del listado si el XML no los trae.
  if (!enriched.issuerName && list.issuerName) enriched.issuerName = list.issuerName;
  if (!enriched.receiverName && list.receiverName) {
    enriched.receiverName = list.receiverName;
  }
  if (!enriched.issuerRfc && list.issuerRfc) enriched.issuerRfc = list.issuerRfc;
  if (!enriched.receiverRfc && list.receiverRfc) {
    enriched.receiverRfc = list.receiverRfc;
  }
  return enriched;
}

export function enrichFromXml(
  xml: string,
  listSatStatus = "unknown",
): EnrichedCfdi | null {
  const parsed = parseCfdiXml(xml);
  if (!parsed?.uuid) return null;
  return fromParsed(parsed, listSatStatus);
}

/** Payload invoice.publish a partir del enriquecido. */
export function toPublishedInvoice(
  e: EnrichedCfdi,
  direction: "emitida" | "recibida",
): PublishedInvoice {
  return {
    uuid: e.uuid,
    external_ref: e.uuid,
    direction,
    source: "satgo_facfiel",
    detail_status: e.detailStatus,
    version: e.version ?? undefined,
    issued_at: e.issuedAt,
    issuer_rfc: e.issuerRfc,
    issuer_name: e.issuerName,
    receiver_rfc: e.receiverRfc,
    receiver_name: e.receiverName,
    voucher_type: e.voucherType,
    payment_form: e.paymentForm,
    payment_method: e.paymentMethod,
    currency: e.currency,
    exchange_rate: e.exchangeRate,
    subtotal: e.subtotal,
    discount: e.discount,
    vat_transferred: e.vatTransferred,
    vat_withheld: e.vatWithheld,
    income_tax_withheld: e.incomeTaxWithheld,
    total: e.total,
    sat_status: e.satStatus,
    is_test: false,
    flags: e.flags,
    concepts: e.concepts.length ? e.concepts : undefined,
    payments: e.payments.length ? e.payments : undefined,
  };
}
