import { format as fnsFormat, parseISO, isValid } from "date-fns";
import { es } from "date-fns/locale";

/**
 * Variables y categorías de las plantillas de correo del área contable.
 *
 * Cada plantilla guarda en la columna `variables` (jsonb) un arreglo con los
 * campos que el usuario debe llenar antes de insertar la plantilla. Este
 * archivo expone tipos, un catálogo por defecto y la función que reemplaza
 * los placeholders `{{var}}` por valores formateados (moneda MXN / fechas
 * es-MX) y en negritas cuando la variable lo requiera.
 */

export type AccountingTemplateCategory =
  | "isn_imss"
  | "previos_provisionales"
  | "pagos_provisionales"
  | "declaracion_ceros"
  | "envio_nominas"
  | "envio_anuales";

export const ACCOUNTING_TEMPLATE_CATEGORY_LABELS: Record<
  AccountingTemplateCategory,
  string
> = {
  isn_imss: "ISN e IMSS",
  previos_provisionales: "Previos provisionales",
  pagos_provisionales: "Pagos provisionales",
  declaracion_ceros: "Declaración provisional en ceros",
  envio_nominas: "Envío de nóminas",
  envio_anuales: "Envío de declaración anual",
};

export const ACCOUNTING_TEMPLATE_CATEGORIES: AccountingTemplateCategory[] = [
  "isn_imss",
  "previos_provisionales",
  "pagos_provisionales",
  "declaracion_ceros",
  "envio_nominas",
  "envio_anuales",
];

export type AccountingVariableType = "text" | "currency" | "date";

export interface AccountingTemplateVariable {
  name: string;
  label: string;
  type: AccountingVariableType;
  bold: boolean;
  required: boolean;
}

export const DEFAULT_VARIABLES_BY_CATEGORY: Record<
  AccountingTemplateCategory,
  AccountingTemplateVariable[]
> = {
  isn_imss: [
    { name: "razon_social", label: "Razón social", type: "text", bold: false, required: true },
    { name: "monto_isn", label: "Monto ISN", type: "currency", bold: false, required: true },
    { name: "monto_imss", label: "Monto IMSS", type: "currency", bold: false, required: true },
    { name: "fecha_limite", label: "Fecha límite de pago", type: "date", bold: true, required: true },
  ],
  previos_provisionales: [
    { name: "razon_social", label: "Razón social", type: "text", bold: false, required: true },
  ],
  pagos_provisionales: [
    { name: "razon_social", label: "Razón social", type: "text", bold: false, required: true },
    { name: "monto_isr", label: "ISR (Impuesto Sobre la Renta)", type: "currency", bold: true, required: true },
    { name: "monto_iva", label: "IVA (Impuesto al Valor Agregado)", type: "currency", bold: true, required: true },
    { name: "ret_sueldos", label: "Retenciones por sueldos", type: "currency", bold: true, required: true },
    { name: "ret_asimilados", label: "Retenciones asimiladas a salarios", type: "currency", bold: true, required: true },
    { name: "ret_iva", label: "Retenciones de IVA", type: "currency", bold: true, required: true },
    { name: "ret_isr", label: "Retenciones de ISR", type: "currency", bold: true, required: true },
    { name: "monto_ieps", label: "IEPS", type: "currency", bold: true, required: true },
    { name: "isr_arrendamiento", label: "ISR Arrendamiento", type: "currency", bold: true, required: true },
    { name: "fecha_limite", label: "Fecha límite de pago", type: "date", bold: true, required: true },
  ],
  declaracion_ceros: [
    { name: "razon_social", label: "Razón social", type: "text", bold: false, required: true },
    { name: "mes_anio", label: "Mes y año de la declaración", type: "text", bold: false, required: true },
  ],
  envio_nominas: [
    { name: "razon_social", label: "Razón social", type: "text", bold: false, required: true },
  ],
  envio_anuales: [
    { name: "razon_social", label: "Razón social", type: "text", bold: false, required: true },
    { name: "saldo_favor", label: "Saldo a favor", type: "currency", bold: true, required: false },
    { name: "a_pagar", label: "Monto a pagar", type: "currency", bold: true, required: false },
    { name: "clabe", label: "CLABE bancaria para devolución", type: "text", bold: true, required: false },
  ],
};

export function isAccountingTemplateCategory(
  value: string | null | undefined,
): value is AccountingTemplateCategory {
  if (!value) return false;
  return (ACCOUNTING_TEMPLATE_CATEGORIES as string[]).includes(value);
}

/** Acepta `variables` de la BD (jsonb) y devuelve un arreglo tipado y limpio. */
export function parseTemplateVariables(
  raw: unknown,
): AccountingTemplateVariable[] {
  if (!Array.isArray(raw)) return [];
  const result: AccountingTemplateVariable[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : null;
    const label = typeof o.label === "string" ? o.label : name;
    if (!name || !label) continue;
    const type: AccountingVariableType =
      o.type === "currency" || o.type === "date" ? o.type : "text";
    result.push({
      name,
      label,
      type,
      bold: Boolean(o.bold),
      required: o.required === undefined ? true : Boolean(o.required),
    });
  }
  return result;
}

const MXN_FORMATTER = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrencyMXN(raw: string): string {
  const cleaned = raw.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return raw;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return raw;
  return MXN_FORMATTER.format(n);
}

export function formatDateES(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(trimmed)
    ? parseISO(trimmed)
    : new Date(trimmed);
  if (!isValid(iso)) return raw;
  return fnsFormat(iso, "d 'de' MMMM 'de' yyyy", { locale: es });
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtmlTags(v: string): string {
  return v.replace(/<[^>]+>/g, "").trim();
}

function formatValue(value: string, type: AccountingVariableType): string {
  const v = value.trim();
  if (!v) return "";
  if (type === "currency") return formatCurrencyMXN(v);
  if (type === "date") return formatDateES(v);
  return v;
}

export interface ApplyTemplateInput {
  subject: string;
  bodyHtml: string;
  variables: AccountingTemplateVariable[];
  values: Record<string, string>;
}

export interface ApplyTemplateResult {
  subject: string;
  bodyHtml: string;
  missing: AccountingTemplateVariable[];
}

/**
 * Reemplaza los `{{name}}` del `subject` y `bodyHtml` por los valores
 * formateados. Para asunto se retira cualquier `<strong>` (los clientes de
 * correo no soportan HTML en subject).
 */
export function applyAccountingTemplate(
  input: ApplyTemplateInput,
): ApplyTemplateResult {
  const missing: AccountingTemplateVariable[] = [];
  let subject = input.subject;
  let body = input.bodyHtml;

  for (const variable of input.variables) {
    const raw = input.values[variable.name] ?? "";
    const formatted = formatValue(raw, variable.type);
    if (variable.required && !formatted) missing.push(variable);

    const bodyReplacement = formatted
      ? variable.bold
        ? `<strong>${escapeHtml(formatted)}</strong>`
        : escapeHtml(formatted)
      : "";
    const subjectReplacement = formatted;

    const placeholder = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, "g");

    body = body.replace(placeholder, bodyReplacement);
    subject = subject.replace(placeholder, subjectReplacement);
  }

  // Evitar que queden `<strong><strong>x</strong></strong>` si la plantilla ya
  // contenía <strong>{{var}}</strong> y la variable también es bold.
  body = body.replace(
    /<strong>(\s*<strong>[^<]*<\/strong>\s*)<\/strong>/g,
    "$1",
  );

  // El asunto nunca debe contener HTML.
  subject = stripHtmlTags(subject);

  return { subject, bodyHtml: body, missing };
}
