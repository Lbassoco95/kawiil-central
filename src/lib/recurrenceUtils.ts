export type RecurrencePattern =
  | "daily"
  | "weekdays"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annual";

export type RecurrenceType = "on_complete" | "scheduled";

export const RECURRENCE_PATTERN_OPTIONS: { value: RecurrencePattern; label: string }[] = [
  { value: "daily", label: "Diario" },
  { value: "weekdays", label: "Días hábiles (lun–vie)" },
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quincenal (cada 2 semanas)" },
  { value: "monthly", label: "Mensual" },
  { value: "quarterly", label: "Trimestral" },
  { value: "annual", label: "Anual" },
];

export const RECURRENCE_TYPE_OPTIONS: { value: RecurrenceType; label: string; description: string }[] = [
  {
    value: "on_complete",
    label: "Al completar",
    description: "Se crea la siguiente ocurrencia cuando se marca como completada",
  },
  {
    value: "scheduled",
    label: "Fecha programada",
    description: "Se crea automáticamente en la fecha calculada, sin importar si se completó",
  },
];

export function recurrencePatternLabel(pattern: string): string {
  return RECURRENCE_PATTERN_OPTIONS.find((o) => o.value === pattern)?.label ?? pattern;
}

export function recurrenceTypeLabel(type: string): string {
  return RECURRENCE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/**
 * Calcula la siguiente fecha de ocurrencia a partir de una fecha base y un patrón.
 * @param fromDate Fecha ISO YYYY-MM-DD
 * @param pattern  Patrón de recurrencia
 * @returns Siguiente fecha ISO YYYY-MM-DD
 */
export function calculateNextOccurrenceDate(fromDate: string, pattern: string): string {
  // Usar mediodía UTC para evitar problemas de zona horaria al convertir a string
  const date = new Date(fromDate + "T12:00:00Z");

  switch (pattern) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case "weekdays":
      date.setUTCDate(date.getUTCDate() + 1);
      while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
        date.setUTCDate(date.getUTCDate() + 1);
      }
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case "biweekly":
      date.setUTCDate(date.getUTCDate() + 14);
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    case "quarterly":
      date.setUTCMonth(date.getUTCMonth() + 3);
      break;
    case "annual":
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
    default:
      date.setUTCDate(date.getUTCDate() + 7);
  }

  return date.toISOString().split("T")[0];
}

/**
 * Formatea una fecha ISO para mostrarla en español de forma compacta.
 */
export function formatRecurrenceDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const months = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  return `${day} ${months[month - 1]} ${year}`;
}
