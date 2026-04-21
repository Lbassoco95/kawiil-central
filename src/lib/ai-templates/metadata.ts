import type { KawiilTemplateKey, KawiilTemplateMeta } from "./types";

/**
 * Metadatos visibles de los templates Kawiil (labels, iconos).
 *
 * Se consume en `ArtifactCard`, `ArtifactViewer` y cualquier UI que
 * quiera mostrar de qué template viene un artifact. El edge function
 * mantiene el mismo registry con schemas Zod + renderers.
 */
export const KAWIIL_TEMPLATE_META: Record<KawiilTemplateKey, KawiilTemplateMeta> = {
  informe_ejecutivo: {
    key: "informe_ejecutivo",
    label: "Informe ejecutivo",
    shortLabel: "Informe",
    description: "Reporte formal con portada, resumen ejecutivo, secciones y recomendaciones.",
    icon: "FileText",
    defaultPrimaryFormat: "pdf",
    suggestedFormats: ["pdf", "docx"],
  },
  minuta_reunion: {
    key: "minuta_reunion",
    label: "Minuta de reunión",
    shortLabel: "Minuta",
    description: "Acta de reunión con asistentes, temas, acuerdos y plan de acción.",
    icon: "Users",
    defaultPrimaryFormat: "pdf",
    suggestedFormats: ["pdf", "docx"],
  },
  propuesta_cotizacion: {
    key: "propuesta_cotizacion",
    label: "Propuesta / cotización",
    shortLabel: "Propuesta",
    description: "Propuesta comercial con alcance, conceptos, totales y términos.",
    icon: "Handshake",
    defaultPrimaryFormat: "pdf",
    suggestedFormats: ["pdf", "docx", "xlsx"],
  },
  factura_remision: {
    key: "factura_remision",
    label: "Factura / remisión",
    shortLabel: "Factura",
    description: "Documento fiscal con emisor, receptor, conceptos y totales.",
    icon: "Receipt",
    defaultPrimaryFormat: "pdf",
    suggestedFormats: ["pdf", "xlsx"],
  },
  reporte_financiero: {
    key: "reporte_financiero",
    label: "Reporte financiero",
    shortLabel: "Financiero",
    description: "Reporte con KPIs, tablas de resultados y notas del periodo.",
    icon: "BarChart3",
    defaultPrimaryFormat: "pdf",
    suggestedFormats: ["pdf", "xlsx", "docx"],
  },
  generico: {
    key: "generico",
    label: "Documento genérico",
    shortLabel: "Documento",
    description: "Documento con secciones libres (fallback cuando no aplica otro template).",
    icon: "FileType2",
    defaultPrimaryFormat: "pdf",
    suggestedFormats: ["pdf", "docx"],
  },
};

export const KAWIIL_TEMPLATE_KEYS: KawiilTemplateKey[] = [
  "informe_ejecutivo",
  "minuta_reunion",
  "propuesta_cotizacion",
  "factura_remision",
  "reporte_financiero",
  "generico",
];

export function getTemplateMeta(key: string | null | undefined): KawiilTemplateMeta | null {
  if (!key) return null;
  return (KAWIIL_TEMPLATE_META as Record<string, KawiilTemplateMeta | undefined>)[key] ?? null;
}

export const FORMAT_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  pptx: "PowerPoint",
};

export const FORMAT_EXT: Record<string, string> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

export const FORMAT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
