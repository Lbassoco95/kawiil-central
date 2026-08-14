/**
 * Catálogo del módulo de Actividades internas del despacho.
 * Cubre convivencias, capacitaciones/cursos y actividades del despacho:
 * eventos internos (no de cliente) a los que se les da control y seguimiento.
 */

// ─── Tipo de actividad ─────────────────────────────────────────────────────
export type ActivityType = "convivencia" | "capacitacion" | "despacho" | "otro";

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  convivencia: "Convivencia",
  capacitacion: "Capacitación / Curso",
  despacho: "Actividad del despacho",
  otro: "Otro",
};

export const ACTIVITY_TYPE_OPTIONS = (
  Object.entries(ACTIVITY_TYPE_LABELS) as [ActivityType, string][]
).map(([value, label]) => ({ value, label }));

export function activityTypeLabel(value?: string | null): string {
  if (!value) return "—";
  return ACTIVITY_TYPE_LABELS[value as ActivityType] ?? value;
}

// ─── Estatus de la actividad ────────────────────────────────────────────────
export type ActivityStatus = "planeacion" | "en_curso" | "completada" | "cancelada";

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  planeacion: "En planeación",
  en_curso: "En curso",
  completada: "Completada",
  cancelada: "Cancelada",
};

/** Clases de color (Tailwind) para el badge de estatus de actividad. */
export const ACTIVITY_STATUS_STYLES: Record<ActivityStatus, string> = {
  planeacion: "bg-amber-100 text-amber-800 border-amber-200",
  en_curso: "bg-blue-100 text-blue-800 border-blue-200",
  completada: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelada: "bg-muted text-muted-foreground border-border",
};

export const ACTIVITY_STATUS_OPTIONS = (
  Object.entries(ACTIVITY_STATUS_LABELS) as [ActivityStatus, string][]
).map(([value, label]) => ({ value, label }));

export function activityStatusLabel(value?: string | null): string {
  if (!value) return "—";
  return ACTIVITY_STATUS_LABELS[value as ActivityStatus] ?? value;
}

// ─── Estatus de cada pendiente / renglón de seguimiento ──────────────────────
export type ActivityItemStatus = "pendiente" | "en_proceso" | "en_revision" | "hecho";

export const ACTIVITY_ITEM_STATUS_LABELS: Record<ActivityItemStatus, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  en_revision: "En revisión",
  hecho: "Hecho",
};

export const ACTIVITY_ITEM_STATUS_STYLES: Record<ActivityItemStatus, string> = {
  pendiente: "bg-muted text-muted-foreground border-border",
  en_proceso: "bg-blue-100 text-blue-800 border-blue-200",
  en_revision: "bg-amber-100 text-amber-800 border-amber-200",
  hecho: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export const ACTIVITY_ITEM_STATUS_OPTIONS = (
  Object.entries(ACTIVITY_ITEM_STATUS_LABELS) as [ActivityItemStatus, string][]
).map(([value, label]) => ({ value, label }));

export function activityItemStatusLabel(value?: string | null): string {
  if (!value) return "—";
  return ACTIVITY_ITEM_STATUS_LABELS[value as ActivityItemStatus] ?? value;
}

// ─── Confirmación de asistentes ──────────────────────────────────────────────
export type AttendeeConfirmed = "si" | "no" | "pendiente";

export const ATTENDEE_CONFIRMED_LABELS: Record<AttendeeConfirmed, string> = {
  si: "Confirma",
  no: "No asiste",
  pendiente: "Pendiente",
};

export const ATTENDEE_CONFIRMED_STYLES: Record<AttendeeConfirmed, string> = {
  si: "bg-emerald-100 text-emerald-800 border-emerald-200",
  no: "bg-rose-100 text-rose-800 border-rose-200",
  pendiente: "bg-muted text-muted-foreground border-border",
};

export const ATTENDEE_CONFIRMED_OPTIONS = (
  Object.entries(ATTENDEE_CONFIRMED_LABELS) as [AttendeeConfirmed, string][]
).map(([value, label]) => ({ value, label }));

// ─── Rubro de proveedor ──────────────────────────────────────────────────────
export type ProviderCategory = "casas" | "alimentos" | "souvenirs" | "obsequios" | "otro";

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  casas: "Casas / Sede",
  alimentos: "Alimentos",
  souvenirs: "Souvenirs",
  obsequios: "Obsequios",
  otro: "Otro",
};

export const PROVIDER_CATEGORY_OPTIONS = (
  Object.entries(PROVIDER_CATEGORY_LABELS) as [ProviderCategory, string][]
).map(([value, label]) => ({ value, label }));

export function providerCategoryLabel(value?: string | null): string {
  if (!value) return "—";
  return PROVIDER_CATEGORY_LABELS[value as ProviderCategory] ?? value;
}

// ─── Estatus de proveedor ────────────────────────────────────────────────────
export type ProviderStatus = "cotizacion" | "elegido" | "apartado" | "pagado" | "descartado";

export const PROVIDER_STATUS_LABELS: Record<ProviderStatus, string> = {
  cotizacion: "Cotización",
  elegido: "Elegido",
  apartado: "Apartado",
  pagado: "Pagado",
  descartado: "Descartado",
};

export const PROVIDER_STATUS_STYLES: Record<ProviderStatus, string> = {
  cotizacion: "bg-muted text-muted-foreground border-border",
  elegido: "bg-blue-100 text-blue-800 border-blue-200",
  apartado: "bg-amber-100 text-amber-800 border-amber-200",
  pagado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  descartado: "bg-rose-100 text-rose-800 border-rose-200",
};

export const PROVIDER_STATUS_OPTIONS = (
  Object.entries(PROVIDER_STATUS_LABELS) as [ProviderStatus, string][]
).map(([value, label]) => ({ value, label }));

export function providerStatusLabel(value?: string | null): string {
  if (!value) return "—";
  return PROVIDER_STATUS_LABELS[value as ProviderStatus] ?? value;
}

// ─── Tipo de archivo (cotizaciones / diseños / muestras) ─────────────────────
export type ActivityFileKind = "cotizacion" | "diseno" | "muestra" | "otro";

export const FILE_KIND_LABELS: Record<ActivityFileKind, string> = {
  cotizacion: "Cotización",
  diseno: "Diseño",
  muestra: "Muestra",
  otro: "Otro",
};

export const FILE_KIND_OPTIONS = (
  Object.entries(FILE_KIND_LABELS) as [ActivityFileKind, string][]
).map(([value, label]) => ({ value, label }));

export function fileKindLabel(value?: string | null): string {
  if (!value) return "—";
  return FILE_KIND_LABELS[value as ActivityFileKind] ?? value;
}
