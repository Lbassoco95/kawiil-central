/**
 * Portal del cliente — lectura y validación estructural de un XML de CFDI (M6).
 *
 * Sin DOM (Deno no trae DOMParser): lectura por etiquetas y atributos, que es
 * lo que se necesita para validar la estructura y sacar los datos de gestión.
 *
 * Qué valida: que sea un Comprobante CFDI 3.3 o 4.0 del espacio de nombres del
 * SAT, con Timbre Fiscal Digital (UUID, sello del SAT, fecha de timbrado),
 * sello y número de certificado del emisor, RFC de emisor y receptor con
 * formato válido, tipo de comprobante y total numérico.
 * Qué NO valida: la firma criptográfica ni el estatus ante el SAT (eso lo da
 * Moffin o la consulta del SAT). Se dice en la respuesta: `verificacion`.
 */
import { isRfcFormat, normalizeRfc } from "./validate.ts";

export interface CfdiConcepto {
  claveProdServ: string | null;
  descripcion: string | null;
  importe: number | null;
}

export interface CfdiParsed {
  version: string | null;
  uuid: string | null;
  fecha: string | null;
  fechaTimbrado: string | null;
  serie: string | null;
  folio: string | null;
  tipoComprobante: string | null;
  formaPago: string | null;
  metodoPago: string | null;
  moneda: string | null;
  tipoCambio: number | null;
  subtotal: number | null;
  descuento: number | null;
  total: number | null;
  noCertificado: string | null;
  tieneSello: boolean;
  tieneSelloSat: boolean;
  emisor: { rfc: string | null; nombre: string | null; regimen: string | null };
  receptor: { rfc: string | null; nombre: string | null; uso: string | null; regimen: string | null; cp: string | null };
  conceptos: CfdiConcepto[];
  ivaTrasladado: number | null;
  ivaRetenido: number | null;
  isrRetenido: number | null;
}

export interface CfdiValidation {
  ok: boolean;
  errors: string[];
  parsed: CfdiParsed | null;
  verificacion: "estructura";
}

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const NS_CFD = /xmlns:(\w+)\s*=\s*["']http:\/\/www\.sat\.gob\.mx\/cfd\/(3|4)["']/;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}

function tagRe(local: string, flags = ""): RegExp {
  return new RegExp(`<(?:[A-Za-z0-9_]+:)?${local}\\b([^>]*?)\\/?>`, flags);
}

function firstTag(xml: string, local: string): Record<string, string> | null {
  const m = xml.match(tagRe(local));
  return m ? parseAttrs(m[1]) : null;
}

function allTags(xml: string, local: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = tagRe(local, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(parseAttrs(m[1]));
  return out;
}

function stripBlock(xml: string, local: string): string {
  return xml.replace(new RegExp(`<(?:[A-Za-z0-9_]+:)?${local}\\b[\\s\\S]*?<\\/(?:[A-Za-z0-9_]+:)?${local}>`, "g"), "");
}

function num(v: string | undefined | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const s = (v: string | undefined | null) => (v == null || v.trim() === "" ? null : v.trim());

export function parseCfdiXml(xmlRaw: string): CfdiParsed | null {
  const xml = xmlRaw.replace(/^﻿/, "");
  const comp = firstTag(xml, "Comprobante");
  if (!comp) return null;
  const emisor = firstTag(xml, "Emisor") ?? {};
  const receptor = firstTag(xml, "Receptor") ?? {};
  const tfd = firstTag(xml, "TimbreFiscalDigital") ?? {};

  const conceptosBlock = xml.match(/<(?:[A-Za-z0-9_]+:)?Conceptos\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?Conceptos>/)?.[0] ?? "";
  const conceptos = allTags(conceptosBlock, "Concepto").map((c) => ({
    claveProdServ: s(c.ClaveProdServ),
    descripcion: s(c.Descripcion),
    importe: num(c.Importe),
  }));

  // Impuestos del comprobante: fuera de Conceptos y de Complemento.
  const outer = stripBlock(stripBlock(xml, "Conceptos"), "Complemento");
  const impBlock = outer.match(/<(?:[A-Za-z0-9_]+:)?Impuestos\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?Impuestos>/)?.[0] ?? "";
  const traslados = allTags(impBlock, "Traslado");
  const retenciones = allTags(impBlock, "Retencion");
  const sum = (rows: Record<string, string>[], imp: string) => {
    const vals = rows.filter((r) => r.Impuesto === imp).map((r) => num(r.Importe)).filter((n): n is number => n !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  const impAttrs = firstTag(impBlock, "Impuestos") ?? {};
  const ivaT = sum(traslados, "002") ?? (traslados.length === 0 && num(impAttrs.TotalImpuestosTrasladados) === 0 ? 0 : null);

  return {
    version: s(comp.Version) ?? s(comp.version),
    uuid: s(tfd.UUID)?.toUpperCase() ?? null,
    fecha: s(comp.Fecha),
    fechaTimbrado: s(tfd.FechaTimbrado),
    serie: s(comp.Serie),
    folio: s(comp.Folio),
    tipoComprobante: s(comp.TipoDeComprobante),
    formaPago: s(comp.FormaPago),
    metodoPago: s(comp.MetodoPago),
    moneda: s(comp.Moneda),
    tipoCambio: num(comp.TipoCambio),
    subtotal: num(comp.SubTotal),
    descuento: num(comp.Descuento),
    total: num(comp.Total),
    noCertificado: s(comp.NoCertificado),
    tieneSello: !!s(comp.Sello),
    tieneSelloSat: !!s(tfd.SelloSAT),
    emisor: { rfc: s(emisor.Rfc) ? normalizeRfc(emisor.Rfc) : null, nombre: s(emisor.Nombre), regimen: s(emisor.RegimenFiscal) },
    receptor: {
      rfc: s(receptor.Rfc) ? normalizeRfc(receptor.Rfc) : null,
      nombre: s(receptor.Nombre),
      uso: s(receptor.UsoCFDI),
      regimen: s(receptor.RegimenFiscalReceptor),
      cp: s(receptor.DomicilioFiscalReceptor),
    },
    conceptos,
    ivaTrasladado: ivaT,
    ivaRetenido: sum(retenciones, "002"),
    isrRetenido: sum(retenciones, "001"),
  };
}

export function validateCfdiXml(xmlRaw: string): CfdiValidation {
  const errors: string[] = [];
  if (!xmlRaw || xmlRaw.length > 5 * 1024 * 1024) {
    return { ok: false, errors: ["El archivo está vacío o pasa de 5 MB."], parsed: null, verificacion: "estructura" };
  }
  if (!NS_CFD.test(xmlRaw)) errors.push("No es un CFDI: falta el espacio de nombres del SAT (cfd/3 o cfd/4).");
  const p = parseCfdiXml(xmlRaw);
  if (!p) {
    errors.push("No se encontró el nodo Comprobante.");
    return { ok: false, errors, parsed: null, verificacion: "estructura" };
  }
  if (p.version !== "4.0" && p.version !== "3.3") errors.push(`Versión de CFDI no admitida: ${p.version ?? "sin versión"}.`);
  if (!p.uuid || !UUID_RE.test(p.uuid)) errors.push("Falta el Timbre Fiscal Digital o su UUID no es válido.");
  if (!p.tieneSelloSat || !p.fechaTimbrado) errors.push("El timbre no trae sello del SAT o fecha de timbrado.");
  if (!p.tieneSello) errors.push("Falta el sello del emisor.");
  if (!p.noCertificado || !/^\d{20}$/.test(p.noCertificado)) errors.push("El número de certificado del emisor no tiene 20 dígitos.");
  if (!p.emisor.rfc || !isRfcFormat(p.emisor.rfc)) errors.push("RFC del emisor con formato inválido.");
  if (!p.receptor.rfc || !isRfcFormat(p.receptor.rfc, { allowGeneric: true })) errors.push("RFC del receptor con formato inválido.");
  if (!p.tipoComprobante || !["I", "E", "T", "N", "P"].includes(p.tipoComprobante)) errors.push("Tipo de comprobante inválido.");
  if (p.total === null) errors.push("El total no es numérico.");
  if (!p.fecha || Number.isNaN(Date.parse(p.fecha))) errors.push("La fecha del comprobante no es válida.");
  return { ok: errors.length === 0, errors, parsed: p, verificacion: "estructura" };
}

/** ¿El CFDI es del cliente? emitida si el cliente es emisor; recibida si es receptor. */
export function directionForClient(p: CfdiParsed, clientRfcs: string[]): "emitida" | "recibida" | null {
  const set = new Set(clientRfcs.map((r) => normalizeRfc(r)).filter(Boolean));
  if (p.emisor.rfc && set.has(p.emisor.rfc)) return "emitida";
  if (p.receptor.rfc && set.has(p.receptor.rfc)) return "recibida";
  return null;
}

/** Fila para portal_cfdi a partir del XML ya validado. */
export function toPortalCfdiRow(p: CfdiParsed, direction: "emitida" | "recibida") {
  const principal = p.conceptos.slice().sort((a, b) => (b.importe ?? 0) - (a.importe ?? 0))[0];
  return {
    uuid: p.uuid!,
    direction,
    version: p.version,
    serie: p.serie,
    folio: p.folio,
    fecha: p.fecha,
    rfc_emisor: p.emisor.rfc,
    nombre_emisor: p.emisor.nombre,
    rfc_receptor: p.receptor.rfc,
    nombre_receptor: p.receptor.nombre,
    tipo_comprobante: p.tipoComprobante,
    uso_cfdi: p.receptor.uso,
    forma_pago: p.formaPago,
    metodo_pago: p.metodoPago,
    moneda: p.moneda,
    tipo_cambio: p.tipoCambio,
    subtotal: p.subtotal,
    descuento: p.descuento,
    iva_trasladado: p.ivaTrasladado,
    iva_retenido: p.ivaRetenido,
    isr_retenido: p.isrRetenido,
    total: p.total,
    clave_prod_serv: principal?.claveProdServ ?? null,
    descripcion: principal?.descripcion ?? null,
  };
}
