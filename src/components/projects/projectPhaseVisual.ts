/** Misma paleta que las fases del tab Tareas (Precios de transferencia, etc.). */
export const PROJECT_PHASE_CARD_COLORS = [
  "bg-blue-500/10 border-blue-500/30",
  "bg-emerald-500/10 border-emerald-500/30",
  "bg-amber-500/10 border-amber-500/30",
  "bg-purple-500/10 border-purple-500/30",
  "bg-rose-500/10 border-rose-500/30",
  "bg-cyan-500/10 border-cyan-500/30",
] as const;

export function projectPhaseColorClass(index: number): string {
  return PROJECT_PHASE_CARD_COLORS[index % PROJECT_PHASE_CARD_COLORS.length];
}

/**
 * Variante ligera: solo un acento en el borde izquierdo por color de fase.
 * Evita el look de "rectángulos gigantes" rellenos y deja las fases como
 * secciones legibles separadas por color.
 */
export const PROJECT_PHASE_ACCENT_COLORS = [
  "border-l-blue-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-purple-500",
  "border-l-rose-500",
  "border-l-cyan-500",
] as const;

export function projectPhaseAccentClass(index: number): string {
  return PROJECT_PHASE_ACCENT_COLORS[index % PROJECT_PHASE_ACCENT_COLORS.length];
}
