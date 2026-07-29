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
