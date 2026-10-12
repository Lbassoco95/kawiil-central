/**
 * Espejo fiscal: mapeo de CFDI publicados y catálogo de operaciones central→OS.
 * Sin e.firma, CIEC ni SatGo. Solo metadatos ya procesados por central.
 */

export const MIRROR_SYSTEM_OPERATIONS = [
  "company.upsert",
  "company.modules",
  "company.delete",
  "document.publish",
  "sat_document.publish",
  "declaration.publish",
  "invoice.publish",
  "fiscal_summary.publish",
  "alert.publish",
  "sat_notification.publish",
  "message.reply",
] as const;

export type MirrorSystemOperation = (typeof MIRROR_SYSTEM_OPERATIONS)[number];

export const SAT_DOC_TYPES = ["tax_status_certificate", "compliance_opinion"] as const;
export const GENERAL_DOC_TYPES = ["declaration", "payment", "financial_statement", "contract", "other"] as const;
export const DECLARATION_DOC_TYPES = ["declaration", "declaracion"] as const;

/** Tipos internos de portal_documents (pantalla Documentos). */
export function mapDocTypeToStorage(docType: string, operation: string): string {
  if (operation === "sat_document.publish") {
    if (docType === "tax_status_certificate") return "constancia";
    if (docType === "compliance_opinion") return "opinion_cumplimiento";
  }
  if (docType === "declaration" || docType === "declaracion") return "declaracion";
  if (docType === "payment") return "pago";
  if (docType === "financial_statement") return "estado_financiero";
  if (docType === "contract") return "contrato";
  if (docType === "other") return "otro";
  return docType;
}

export interface PublishedInvoiceConcept {
  product_service_key?: string | null;
  description: string;
  quantity: number;
  unit_value: number;
  amount: number;
  discount?: number;
}

export interface PublishedTaxLine {
  tax: string;
  kind: "transfer" | "withholding";
  rate?: number | null;
  factor?: string | null;
  base: number;
  amount: number;
}

export interface PublishedPaymentLink {
  related_uuid: string;
  paid_at: string;
  paid_amount: number;
}

export interface PublishedInvoice {
  uuid: string;
  external_ref?: string;
  direction: "emitida" | "recibida";
  source?: string;
  detail_status?: "metadata" | "complete";
  version?: string;
  issued_at?: string | null;
  issuer_rfc?: string | null;
  issuer_name?: string | null;
  receiver_rfc?: string | null;
  receiver_name?: string | null;
  voucher_type?: string | null;
  payment_form?: string | null;
  payment_method?: "PUE" | "PPD" | string | null;
  currency?: string;
  exchange_rate?: number | null;
  subtotal?: number;
  discount?: number;
  vat_transferred?: number;
  vat_withheld?: number;
  income_tax_withheld?: number;
  ieps?: number;
  other_taxes?: number;
  total?: number;
  sat_status?: string;
  xml_path?: string | null;
  pdf_path?: string | null;
  is_test?: boolean;
  flags?: unknown[];
  category_name?: string | null;
  category_status?: string | null;
  tax_lines?: PublishedTaxLine[];
  concepts?: PublishedInvoiceConcept[];
  payments?: PublishedPaymentLink[];
}

export function vatByRateFromTaxLines(lines: PublishedTaxLine[] | undefined): Partial<Record<"16" | "8" | "0" | "exempt", number>> {
  const out: Partial<Record<"16" | "8" | "0" | "exempt", number>> = {};
  for (const line of lines ?? []) {
    if (line.kind !== "transfer" || !/^IVA$/i.test(line.tax)) continue;
    const rate = line.rate ?? null;
    const key = rate === 0.16 || rate === 16 ? "16"
      : rate === 0.08 || rate === 8 ? "8"
      : rate === 0 ? "0"
      : "exempt";
    out[key] = Math.round(((out[key] ?? 0) + Number(line.amount || 0)) * 100) / 100;
  }
  return out;
}

export function dataQualityFromInvoices(rows: { detail_status: string }[]): {
  complete: number;
  metadata_only: number;
  quality_label: "alta" | "media" | "baja";
  quality_note: string;
} {
  const complete = rows.filter((r) => r.detail_status === "complete").length;
  const metadata_only = rows.length - complete;
  const ratio = rows.length ? complete / rows.length : 1;
  const quality_label = ratio >= 0.9 ? "alta" : ratio >= 0.6 ? "media" : "baja";
  const quality_note = metadata_only === 0
    ? "Todas las facturas del periodo tienen detalle fiscal completo."
    : `${metadata_only} de ${rows.length} factura(s) solo traen metadatos; el IVA estimado no las incluye.`;
  return { complete, metadata_only, quality_label, quality_note };
}

/** Ruta F5 en central: dónde viven constancia y opinión antes de publicar a OS. */
export const CENTRAL_SAT_DOCUMENT_PATH = {
  table: "public.moffin_consults",
  consult_types: ["constancia_situacion_fiscal", "opinion_cumplimiento"] as const,
  document_fk: "document_id → public.documents",
  storage_bucket: "documents",
  storage_path_pattern: "{organization_id}/moffin/clientes/{client_id}/{yyyy}/{mm}/{timestamp}_{base}.pdf",
  builder: "supabase/functions/_shared/moffinStoragePath.ts → buildMoffinPdfStoragePath",
  publish_op: "sat_document.publish",
  note: "Central copia el PDF al bucket portal de Kawiil OS y luego firma sat_document.publish. OS nunca recibe e.firma, CIEC ni SatGo.",
} as const;
