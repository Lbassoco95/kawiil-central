/**
 * JSON Schemas (dialecto Anthropic tool.input_schema) para cada template
 * Kawiil. Se exponen al tool `create_ai_document` en `ai-chat` y también
 * se usan para validación ligera en `render-ai-document`.
 *
 * No se usa Zod para evitar importar dependencias grandes en el edge;
 * las validaciones runtime son explícitas y permisivas (la IA a veces
 * omite campos opcionales o los renombra levemente).
 */

import type {
  ExecutiveReportData,
  FinancialReportData,
  GenericDocumentData,
  InvoiceData,
  KawiilTemplateKey,
  MeetingMinutesData,
  ProposalData,
} from "./types.ts";
import { reconcileDocumentMoney } from "../moneyCalc.ts";

// ─── Building blocks reutilizables ───

const metadataSchema = {
  type: "object",
  properties: {
    code: { type: "string", description: "Código o folio del documento (ej. DAZ-CI-INF-01)." },
    emisor: { type: "string", description: "Área o entidad emisora." },
    destinatario: { type: "string", description: "Destinatario principal." },
    fecha: { type: "string", description: "Fecha visible en portada (formato libre)." },
    version: { type: "string" },
    clasificacion: { type: "string", description: "Ej: 'Confidencial — Uso Interno'." },
  },
};

const tableSchema = {
  type: "object",
  properties: {
    headers: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    caption: { type: "string" },
  },
  required: ["headers", "rows"],
};

const sectionSchema = {
  type: "object",
  properties: {
    heading: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
    bullets: { type: "array", items: { type: "string" } },
    tables: { type: "array", items: tableSchema },
    callout: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["info", "warning", "success"] },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["body"],
    },
  },
};

const lineItemSchema = {
  type: "object",
  properties: {
    description: { type: "string" },
    quantity: { type: "number" },
    unit: { type: "string" },
    unit_price: { type: "number" },
    amount: { type: "number" },
    notes: { type: "string" },
  },
  required: ["description"],
};

const kvSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    value: { type: "string" },
  },
  required: ["label", "value"],
};

// ─── Schemas por template ───

export const EXECUTIVE_REPORT_SCHEMA = {
  type: "object",
  description: "Informe ejecutivo: portada con metadatos, resumen, secciones temáticas y recomendaciones.",
  properties: {
    metadata: metadataSchema,
    summary: { type: "string", description: "Resumen ejecutivo (1-2 párrafos)." },
    sections: { type: "array", items: sectionSchema },
    recommendations: { type: "array", items: { type: "string" } },
    signatures: {
      type: "array",
      items: {
        type: "object",
        properties: { role: { type: "string" }, name: { type: "string" } },
        required: ["role"],
      },
    },
  },
  required: ["sections"],
};

export const MEETING_MINUTES_SCHEMA = {
  type: "object",
  description: "Minuta de reunión: asistentes, agenda, temas discutidos, acuerdos y plan de acción.",
  properties: {
    metadata: metadataSchema,
    attendees: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, role: { type: "string" } },
        required: ["name"],
      },
    },
    absentees: { type: "array", items: { type: "string" } },
    agenda: { type: "array", items: { type: "string" } },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, discussion: { type: "string" } },
        required: ["title"],
      },
    },
    agreements: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          owner: { type: "string" },
          due_date: { type: "string" },
        },
        required: ["task"],
      },
    },
    next_meeting: { type: "string" },
  },
  required: ["topics"],
};

export const PROPOSAL_SCHEMA = {
  type: "object",
  description: "Propuesta comercial / cotización: cliente, alcance, conceptos con precios y totales.",
  properties: {
    metadata: metadataSchema,
    client: { type: "array", items: kvSchema },
    summary: { type: "string" },
    scope: { type: "array", items: sectionSchema },
    line_items: { type: "array", items: lineItemSchema },
    currency: { type: "string", description: "Código ISO (MXN, USD)." },
    subtotal: { type: "number" },
    taxes: { type: "number" },
    total: { type: "number" },
    terms: { type: "array", items: { type: "string" } },
    validity: { type: "string" },
  },
  required: ["line_items"],
};

export const INVOICE_SCHEMA = {
  type: "object",
  description: "Factura / remisión: emisor, receptor, conceptos y totales.",
  properties: {
    metadata: metadataSchema,
    emisor: { type: "array", items: kvSchema },
    receptor: { type: "array", items: kvSchema },
    folio: { type: "string" },
    fecha: { type: "string" },
    line_items: { type: "array", items: lineItemSchema },
    currency: { type: "string" },
    subtotal: { type: "number" },
    taxes: { type: "number" },
    total: { type: "number" },
    legal_notes: { type: "array", items: { type: "string" } },
  },
  required: ["emisor", "receptor", "line_items"],
};

export const FINANCIAL_REPORT_SCHEMA = {
  type: "object",
  description: "Reporte financiero: periodo, KPIs, tablas comparativas y notas.",
  properties: {
    metadata: metadataSchema,
    period: { type: "string" },
    kpis: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          delta: { type: "string" },
        },
        required: ["label", "value"],
      },
    },
    summary: { type: "string" },
    tables: { type: "array", items: tableSchema },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["tables"],
};

export const GENERIC_DOC_SCHEMA = {
  type: "object",
  description: "Documento genérico: secciones libres (fallback).",
  properties: {
    metadata: metadataSchema,
    summary: { type: "string" },
    sections: { type: "array", items: sectionSchema },
  },
  required: ["sections"],
};

export const KAWIIL_TEMPLATE_SCHEMAS: Record<KawiilTemplateKey, Record<string, unknown>> = {
  informe_ejecutivo: EXECUTIVE_REPORT_SCHEMA,
  minuta_reunion: MEETING_MINUTES_SCHEMA,
  propuesta_cotizacion: PROPOSAL_SCHEMA,
  factura_remision: INVOICE_SCHEMA,
  reporte_financiero: FINANCIAL_REPORT_SCHEMA,
  generico: GENERIC_DOC_SCHEMA,
};

// ─── Validación ligera ───

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function ensureString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function ensureNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function normalizeTemplateData(
  key: KawiilTemplateKey,
  raw: Record<string, unknown>,
): unknown {
  switch (key) {
    case "informe_ejecutivo": {
      const data: ExecutiveReportData = {
        metadata: raw.metadata as ExecutiveReportData["metadata"],
        summary: ensureString(raw.summary),
        sections: ensureArray(raw.sections),
        recommendations: ensureArray<string>(raw.recommendations),
        signatures: ensureArray(raw.signatures),
      };
      if (!data.sections.length) throw new Error("informe_ejecutivo.sections no puede estar vacío.");
      return data;
    }
    case "minuta_reunion": {
      const data: MeetingMinutesData = {
        metadata: raw.metadata as MeetingMinutesData["metadata"],
        attendees: ensureArray(raw.attendees),
        absentees: ensureArray<string>(raw.absentees),
        agenda: ensureArray<string>(raw.agenda),
        topics: ensureArray(raw.topics),
        agreements: ensureArray<string>(raw.agreements),
        action_items: ensureArray(raw.action_items),
        next_meeting: ensureString(raw.next_meeting),
      };
      if (!data.topics.length) throw new Error("minuta_reunion.topics no puede estar vacío.");
      return data;
    }
    case "propuesta_cotizacion": {
      const data: ProposalData = {
        metadata: raw.metadata as ProposalData["metadata"],
        client: ensureArray(raw.client),
        summary: ensureString(raw.summary),
        scope: ensureArray(raw.scope),
        line_items: ensureArray(raw.line_items),
        currency: ensureString(raw.currency) || "MXN",
        subtotal: ensureNumber(raw.subtotal),
        taxes: ensureNumber(raw.taxes),
        total: ensureNumber(raw.total),
        terms: ensureArray<string>(raw.terms),
        validity: ensureString(raw.validity),
      };
      if (!data.line_items.length) throw new Error("propuesta_cotizacion.line_items no puede estar vacío.");
      const money = reconcileDocumentMoney(data.line_items, data.taxes);
      data.line_items = money.line_items as ProposalData["line_items"];
      data.subtotal = money.subtotal;
      if (money.taxes !== undefined) data.taxes = money.taxes;
      data.total = money.total;
      return data;
    }
    case "factura_remision": {
      const data: InvoiceData = {
        metadata: raw.metadata as InvoiceData["metadata"],
        emisor: ensureArray(raw.emisor),
        receptor: ensureArray(raw.receptor),
        folio: ensureString(raw.folio),
        fecha: ensureString(raw.fecha),
        line_items: ensureArray(raw.line_items),
        currency: ensureString(raw.currency) || "MXN",
        subtotal: ensureNumber(raw.subtotal),
        taxes: ensureNumber(raw.taxes),
        total: ensureNumber(raw.total),
        legal_notes: ensureArray<string>(raw.legal_notes),
      };
      if (!data.emisor.length || !data.receptor.length || !data.line_items.length) {
        throw new Error("factura_remision requiere emisor, receptor y line_items.");
      }
      const money = reconcileDocumentMoney(data.line_items, data.taxes);
      data.line_items = money.line_items as InvoiceData["line_items"];
      data.subtotal = money.subtotal;
      if (money.taxes !== undefined) data.taxes = money.taxes;
      data.total = money.total;
      return data;
    }
    case "reporte_financiero": {
      const data: FinancialReportData = {
        metadata: raw.metadata as FinancialReportData["metadata"],
        period: ensureString(raw.period),
        kpis: ensureArray(raw.kpis),
        summary: ensureString(raw.summary),
        tables: ensureArray(raw.tables),
        notes: ensureArray<string>(raw.notes),
      };
      if (!data.tables.length) throw new Error("reporte_financiero.tables no puede estar vacío.");
      return data;
    }
    case "generico": {
      const data: GenericDocumentData = {
        metadata: raw.metadata as GenericDocumentData["metadata"],
        summary: ensureString(raw.summary),
        sections: ensureArray(raw.sections),
      };
      if (!data.sections.length) throw new Error("generico.sections no puede estar vacío.");
      return data;
    }
    default:
      throw new Error(`template_key inválido: ${key}`);
  }
}

export function isKawiilTemplateKey(value: unknown): value is KawiilTemplateKey {
  return (
    value === "informe_ejecutivo" ||
    value === "minuta_reunion" ||
    value === "propuesta_cotizacion" ||
    value === "factura_remision" ||
    value === "reporte_financiero" ||
    value === "generico"
  );
}

export const KAWIIL_OUTPUT_FORMATS = ["pdf", "docx", "xlsx", "pptx"] as const;
