/**
 * Kawiil Grados — sistema de niveles de crecimiento profesional.
 * Reemplaza el concepto tradicional de "roles" con grados colaborativos.
 */

export type AppGrado = "en_formacion" | "ejecutor" | "referente" | "transformador";

export interface GradoConfig {
  label: string;
  shortLabel: string;
  emoji: string;
  description: string;
  badgeClass: string;
}

export const GRADO_CONFIG: Record<AppGrado, GradoConfig> = {
  en_formacion: {
    label: "Kawiiler En Formación",
    shortLabel: "G1 - En Formación",
    emoji: "🐣",
    description: "Aprende los procesos clave, se integra a la cultura y documenta lo aprendido.",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  ejecutor: {
    label: "Kawiiler Ejecutor",
    shortLabel: "G2 - Ejecutor",
    emoji: "🛠️",
    description: "Ejecuta con autonomía, mejora procesos, aporta calidad técnica y propone soluciones.",
    badgeClass: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  referente: {
    label: "Kawiiler Referente",
    shortLabel: "G3 - Referente",
    emoji: "🔍",
    description: "Guía a otros, documenta, capacita y lidera procesos internos o técnicos sin rol jerárquico.",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  transformador: {
    label: "Kawiiler Transformador",
    shortLabel: "G4 - Transformador",
    emoji: "🚀",
    description: "Lidera proyectos de innovación, automatización o estrategia transversal. Inspira desde la experiencia.",
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  },
};

/** Map for Select components: value → display label with emoji */
export const GRADO_SELECT_OPTIONS: { value: AppGrado; label: string }[] = [
  { value: "en_formacion", label: "🐣 G1 - En Formación" },
  { value: "ejecutor", label: "🛠️ G2 - Ejecutor" },
  { value: "referente", label: "🔍 G3 - Referente" },
  { value: "transformador", label: "🚀 G4 - Transformador" },
];

/** Quick label lookup */
export function gradoLabel(grado: string): string {
  const config = GRADO_CONFIG[grado as AppGrado];
  return config ? `${config.emoji} ${config.shortLabel}` : grado;
}

/** Quick badge class lookup */
export function gradoBadgeClass(grado: string): string {
  return GRADO_CONFIG[grado as AppGrado]?.badgeClass ?? "bg-muted text-muted-foreground";
}
