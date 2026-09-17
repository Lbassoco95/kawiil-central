/**
 * Constantes del módulo de Juntas (Múuch', tablas `mtg_*`).
 *
 * Las listas de valores son espejo exacto de los CHECK de la migración
 * `20260917120000_mtg_juntas_schema.sql`. Si aquí se agrega un valor y allá
 * no (o al revés), la base rechaza el INSERT: las dos listas se mueven
 * juntas (constants.test.ts lo vigila).
 */

// ── Movimiento de un tema en una junta (mtg_topic_updates.movement) ──
export const MOVEMENT = {
  resolved: {
    label: "Resuelto",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  advanced: {
    label: "Avanzó",
    color: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  },
  unchanged: {
    label: "Sin cambio",
    color: "bg-muted text-muted-foreground",
  },
  new: {
    label: "Nuevo",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  decision_needed: {
    label: "Requiere decisión",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  blocked_third_party: {
    label: "Bloqueado por tercero",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
  waiting_authority: {
    label: "Esperando autoridad",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
} as const;

export type MtgMovement = keyof typeof MOVEMENT;

/** Orden en que se revisan los temas abiertos al preparar la junta. */
export const MOVEMENT_OPEN_ORDER: MtgMovement[] = [
  "blocked_third_party",
  "decision_needed",
  "advanced",
  "unchanged",
  "waiting_authority",
];

// ── Estado de la junta (mtg_meetings.status) ──
export const MEETING_STATUS = {
  planned: { label: "Programada", color: "bg-muted text-muted-foreground" },
  in_progress: { label: "En curso", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  ended: { label: "Terminada", color: "bg-muted text-muted-foreground" },
  minutes_draft: { label: "Minuta en borrador", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  minutes_review: { label: "Minuta en revisión", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  minutes_approved: { label: "Minuta aprobada", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  closed: { label: "Cerrada", color: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelada", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  no_show: { label: "No se presentó", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
} as const;

export type MtgMeetingStatus = keyof typeof MEETING_STATUS;

// ── Estado del acuerdo (mtg_agreements.status) ──
export const AGREEMENT_STATUS = {
  proposed: { label: "Propuesto", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  confirmed: { label: "Confirmado", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  rejected: { label: "Rechazado", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
} as const;

export type MtgAgreementStatus = keyof typeof AGREEMENT_STATUS;

// ── Estado del tema (mtg_topics.status) ──
export const TOPIC_STATUS = {
  open: { label: "Abierto", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  resolved: { label: "Resuelto", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  dropped: { label: "Descartado", color: "bg-muted text-muted-foreground" },
} as const;

export type MtgTopicStatus = keyof typeof TOPIC_STATUS;

// ── Cadencia de la serie (mtg_series.cadence) ──
export const CADENCE = {
  weekly: { label: "Semanal" },
  biweekly: { label: "Quincenal" },
  monthly: { label: "Mensual" },
  adhoc: { label: "Sin cadencia (ad hoc)" },
} as const;

export type MtgCadence = keyof typeof CADENCE;

// ── Estado de la transcripción (mtg_meetings.transcript_status) ──
export const TRANSCRIPT_STATUS = {
  not_requested: { label: "No solicitada", color: "bg-muted text-muted-foreground" },
  subscribed: { label: "Suscrita", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  received: { label: "Recibida", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  failed: { label: "Falló", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  unavailable: { label: "No disponible", color: "bg-muted text-muted-foreground" },
} as const;

export type MtgTranscriptStatus = keyof typeof TRANSCRIPT_STATUS;

/**
 * Agenda base de una serie nueva: la migración deja `agenda_template` en '[]'
 * y es el front quien precarga estos bloques.
 */
export const DEFAULT_AGENDA_TEMPLATE: { key: string; title: string }[] = [
  { key: "previous_agreements", title: "Acuerdos de la junta anterior" },
  { key: "open_items", title: "Pendientes abiertos" },
  { key: "deadlines", title: "Vencimientos próximos" },
  { key: "new_topics", title: "Temas nuevos" },
  { key: "next_steps", title: "Próximos pasos" },
];
