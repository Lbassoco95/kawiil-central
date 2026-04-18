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

/**
 * Para variables monetarias que soportan varios modos:
 * - `pago`: monto normal (comportamiento por defecto).
 * - `favor`: saldo a favor; se formatea igual que pago pero se anexa un
 *   sufijo (`favorText`, default "(saldo a favor)").
 * - `perdida`: no aplica / pérdida; se omite la línea (cualquier elemento
 *   con `data-kvt-var="<name>"`) del cuerpo del correo.
 */
export type CurrencyMode = "pago" | "favor" | "perdida";

export const DEFAULT_CURRENCY_MODE: CurrencyMode = "pago";
export const DEFAULT_FAVOR_TEXT = "(saldo a favor)";

export interface AccountingTemplateVariable {
  name: string;
  label: string;
  type: AccountingVariableType;
  bold: boolean;
  required: boolean;
  /**
   * Si `true`, el formulario permitirá elegir entre "monto a pagar",
   * "saldo a favor" y "pérdida / no aplica". Las plantillas deben envolver
   * la línea condicional con `data-kvt-var="<name>"` para que el modo
   * `perdida` pueda eliminarla.
   */
  modeSupport?: boolean;
  /** Texto que se anexa cuando el modo es `favor`. */
  favorText?: string;
}

export function supportsCurrencyMode(
  v: Pick<AccountingTemplateVariable, "type" | "modeSupport">,
): boolean {
  return Boolean(v.modeSupport) && v.type === "currency";
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
    { name: "monto_isr", label: "ISR (Impuesto Sobre la Renta)", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "monto_iva", label: "IVA (Impuesto al Valor Agregado)", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "ret_sueldos", label: "Retenciones por sueldos", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "ret_asimilados", label: "Retenciones asimiladas a salarios", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "ret_iva", label: "Retenciones de IVA", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "ret_isr", label: "Retenciones de ISR", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "monto_ieps", label: "IEPS", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "isr_arrendamiento", label: "ISR Arrendamiento", type: "currency", bold: true, required: true, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
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
    { name: "saldo_favor", label: "Saldo a favor", type: "currency", bold: true, required: false, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
    { name: "a_pagar", label: "Monto a pagar", type: "currency", bold: true, required: false, modeSupport: true, favorText: DEFAULT_FAVOR_TEXT },
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
    // Acepta tanto snake_case (jsonb) como camelCase por compatibilidad.
    const modeSupportRaw =
      o.mode_support !== undefined ? o.mode_support : o.modeSupport;
    const favorTextRaw =
      typeof o.favor_text === "string"
        ? o.favor_text
        : typeof o.favorText === "string"
          ? o.favorText
          : undefined;
    result.push({
      name,
      label,
      type,
      bold: Boolean(o.bold),
      required: o.required === undefined ? true : Boolean(o.required),
      modeSupport: modeSupportRaw === undefined ? false : Boolean(modeSupportRaw),
      favorText: favorTextRaw,
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
  /**
   * Modo por variable. Solo se toma en cuenta para variables con
   * `modeSupport: true`. Default = "pago".
   */
  modes?: Record<string, CurrencyMode>;
}

export interface ApplyTemplateResult {
  subject: string;
  bodyHtml: string;
  missing: AccountingTemplateVariable[];
}

/**
 * Remueve del HTML cualquier elemento (`<li>`, `<p>`, `<div>`, etc.) que
 * tenga el atributo `data-kvt-var="<name>"`. Multiline-safe y tolera
 * comillas simples.
 */
function stripLineForVar(html: string, name: string): string {
  const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = new RegExp(
    `<(\\w+)\\b[^>]*\\bdata-kvt-var\\s*=\\s*["']${escaped}["'][^>]*>[\\s\\S]*?<\\/\\1>`,
    "gi",
  );
  return html.replace(pattern, "");
}

/**
 * Reemplaza los `{{name}}` del `subject` y `bodyHtml` por los valores
 * formateados. Para asunto se retira cualquier `<strong>` (los clientes de
 * correo no soportan HTML en subject).
 *
 * Soporta 3 modos por variable (cuando `modeSupport` es true):
 *  - `pago` (default): monto normal.
 *  - `favor`: formatea como monto y añade el sufijo `favorText`.
 *  - `perdida`: remueve cualquier `<elem data-kvt-var="name">...</elem>`
 *    del body y deja el placeholder en blanco.
 *
 * Además, para variables NO requeridas cuyo valor quedó vacío, también se
 * elimina su línea envuelta (si existe), evitando dejar texto colgando.
 */
export function applyAccountingTemplate(
  input: ApplyTemplateInput,
): ApplyTemplateResult {
  const missing: AccountingTemplateVariable[] = [];
  let subject = input.subject;
  let body = input.bodyHtml;
  const modes = input.modes ?? {};

  for (const variable of input.variables) {
    const rawMode = modes[variable.name];
    const mode: CurrencyMode =
      supportsCurrencyMode(variable) && rawMode ? rawMode : "pago";
    const raw = input.values[variable.name] ?? "";
    const formatted = mode === "perdida" ? "" : formatValue(raw, variable.type);

    const isRequired = variable.required && mode !== "perdida";
    if (isRequired && !formatted) missing.push(variable);

    const favorSuffix =
      mode === "favor" ? ` ${variable.favorText ?? DEFAULT_FAVOR_TEXT}` : "";

    let bodyReplacement = "";
    if (formatted) {
      const safe = escapeHtml(formatted);
      bodyReplacement = variable.bold
        ? `<strong>${safe}${escapeHtml(favorSuffix)}</strong>`
        : `${safe}${escapeHtml(favorSuffix)}`;
    }
    const subjectReplacement = formatted ? `${formatted}${favorSuffix}` : "";

    const placeholder = new RegExp(`\\{\\{\\s*${variable.name}\\s*\\}\\}`, "g");
    body = body.replace(placeholder, bodyReplacement);
    subject = subject.replace(placeholder, subjectReplacement);

    // Modo pérdida: remueve el <li>/<p>/... envolvente con data-kvt-var.
    if (mode === "perdida") {
      body = stripLineForVar(body, variable.name);
    }

    // Variable opcional vacía: también removemos la línea envuelta (si existe)
    // para no dejar texto colgando tipo "Esta es la CLABE bancaria ...".
    if (!variable.required && !formatted && mode !== "perdida") {
      body = stripLineForVar(body, variable.name);
    }
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
