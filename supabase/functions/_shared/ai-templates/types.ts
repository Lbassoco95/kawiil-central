/**
 * Mirror of `src/lib/ai-templates/types.ts` for Deno edge functions.
 * Mantener alineado: si cambia el schema aquí, actualizar la versión
 * del frontend (o viceversa) para preservar el contrato que viaja
 * en `ai_artifacts.template_data` y `output_formats`.
 */

export type KawiilTemplateKey =
  | "informe_ejecutivo"
  | "minuta_reunion"
  | "propuesta_cotizacion"
  | "factura_remision"
  | "reporte_financiero"
  | "generico";

export type KawiilOutputFormat = "pdf" | "docx" | "xlsx" | "pptx";

export interface KawiilArtifactOutput {
  format: KawiilOutputFormat;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  is_primary?: boolean;
}

export interface KawiilDocumentMetadata {
  code?: string;
  emisor?: string;
  destinatario?: string;
  fecha?: string;
  version?: string;
  clasificacion?: string;
}

export interface KawiilKeyValue {
  label: string;
  value: string;
}

export interface KawiilTable {
  headers: string[];
  rows: string[][];
  caption?: string;
}

export interface KawiilSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  tables?: KawiilTable[];
  callout?: { kind?: "info" | "warning" | "success"; title?: string; body: string };
}

export interface KawiilLineItem {
  description: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  amount?: number;
  notes?: string;
}

export interface ExecutiveReportData {
  metadata?: KawiilDocumentMetadata;
  summary?: string;
  sections: KawiilSection[];
  recommendations?: string[];
  signatures?: Array<{ role: string; name?: string }>;
}

export interface MeetingMinutesData {
  metadata?: KawiilDocumentMetadata;
  attendees?: Array<{ name: string; role?: string }>;
  absentees?: string[];
  agenda?: string[];
  topics: Array<{ title: string; discussion?: string }>;
  agreements?: string[];
  action_items?: Array<{ task: string; owner?: string; due_date?: string }>;
  next_meeting?: string;
}

export interface ProposalData {
  metadata?: KawiilDocumentMetadata;
  client?: KawiilKeyValue[];
  summary?: string;
  scope?: KawiilSection[];
  line_items: KawiilLineItem[];
  currency?: string;
  subtotal?: number;
  taxes?: number;
  total?: number;
  terms?: string[];
  validity?: string;
}

export interface InvoiceData {
  metadata?: KawiilDocumentMetadata;
  emisor: KawiilKeyValue[];
  receptor: KawiilKeyValue[];
  folio?: string;
  fecha?: string;
  line_items: KawiilLineItem[];
  currency?: string;
  subtotal?: number;
  taxes?: number;
  total?: number;
  legal_notes?: string[];
}

export interface FinancialReportData {
  metadata?: KawiilDocumentMetadata;
  period?: string;
  kpis?: Array<{ label: string; value: string; delta?: string }>;
  summary?: string;
  tables: KawiilTable[];
  notes?: string[];
}

export interface GenericDocumentData {
  metadata?: KawiilDocumentMetadata;
  summary?: string;
  sections: KawiilSection[];
}

export type KawiilTemplateData =
  | ({ template_key: "informe_ejecutivo" } & ExecutiveReportData)
  | ({ template_key: "minuta_reunion" } & MeetingMinutesData)
  | ({ template_key: "propuesta_cotizacion" } & ProposalData)
  | ({ template_key: "factura_remision" } & InvoiceData)
  | ({ template_key: "reporte_financiero" } & FinancialReportData)
  | ({ template_key: "generico" } & GenericDocumentData);

export interface RenderAiDocumentRequest {
  title: string;
  template_key: KawiilTemplateKey;
  requested_formats: KawiilOutputFormat[];
  content: Record<string, unknown>;
  confidence?: number;
  reason?: string;
  /** Preview corta en markdown (opcional) para fallback textual del artifact. */
  preview_markdown?: string;
  /** Header params para el PDF (org, logo_url). */
  branding?: {
    org_name?: string;
    logo_url?: string;
    primary_color?: string;
  };
}

export interface RenderedFormat {
  format: KawiilOutputFormat;
  file_name: string;
  file_ext: string;
  mime_type: string;
  content_base64: string;
}

export interface RenderAiDocumentResponse {
  success: true;
  template_key: KawiilTemplateKey;
  title: string;
  primary_format: KawiilOutputFormat;
  preview_markdown: string;
  formats: RenderedFormat[];
}
