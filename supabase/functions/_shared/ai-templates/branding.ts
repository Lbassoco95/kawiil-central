/**
 * Branding Kawiil para renderers PDF/DOCX/XLSX.
 *
 * ## Membretado por organización (fase incremental)
 * La tabla `organizations.settings` (JSON) puede incluir:
 * `{ "ai_document_branding": { "org_name"?: string, "logo_url"?: string, "primary_color"?: string } }`
 * Esos valores se fusionan en `render-ai-document` vía `resolveBranding` cuando `ai-chat`
 * los envía en el payload (nombre de org siempre que exista fila).
 *
 * La paleta y la tipografía siguen los tokens del design-system
 * (azul Kawiil v2.4). Cualquier cambio visual centralizado debe
 * reflejarse aquí para mantener consistencia en todos los templates.
 */

export const KAWIIL_BRAND = {
  primary: "#0EA5E9", // sky-500 (KAWIIL_AI_GRADIENT start)
  primaryDark: "#2563EB", // blue-600 (KAWIIL_AI_GRADIENT end)
  accent: "#1E40AF", // blue-800 (headings)
  textMain: "#0F172A", // slate-900
  textMuted: "#475569", // slate-600
  tableHeaderBg: "#0EA5E9",
  tableHeaderText: "#FFFFFF",
  tableRowAlt: "#F1F5F9", // slate-100
  border: "#CBD5E1", // slate-300
  borderSoft: "#E2E8F0", // slate-200
  calloutInfoBg: "#EFF6FF", // blue-50
  calloutInfoBorder: "#3B82F6", // blue-500
  calloutWarningBg: "#FFFBEB", // amber-50
  calloutWarningBorder: "#F59E0B", // amber-500
  calloutSuccessBg: "#ECFDF5", // emerald-50
  calloutSuccessBorder: "#10B981", // emerald-500
  background: "#FFFFFF",
  footerText: "#64748B", // slate-500
} as const;

export const KAWIIL_FONTS = {
  /** Fuente principal para PDF (pdfmake usa sus defaults, Roboto). */
  pdfDefault: "Roboto",
  /** Fuente heading (misma familia para evitar carga de fonts externos). */
  pdfHeading: "Roboto",
} as const;

export interface KawiilBrandingInput {
  orgName?: string;
  logoUrl?: string;
  primaryColor?: string;
}

export function resolveBranding(input?: KawiilBrandingInput) {
  return {
    orgName: input?.orgName?.trim() || "Kawiil",
    logoUrl: input?.logoUrl?.trim() || "",
    primary: input?.primaryColor?.trim() || KAWIIL_BRAND.primary,
  };
}
