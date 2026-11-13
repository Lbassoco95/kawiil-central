// Textos de presentación compartidos por las pantallas de seguimiento (sin React, para no crear importaciones circulares).
export const ETIQUETA_ESTADO: Record<string, { texto: string; tono: string }> = {
  pending: { texto: "En espera", tono: "border-border/60" }, queued: { texto: "En cola", tono: "border-border/60" },
  in_progress: { texto: "Trabajando", tono: "border-sky-400/60 bg-sky-50/50" }, waiting_approval: { texto: "Espera tu aprobación", tono: "border-amber-400/60 bg-amber-50/50" },
  completed: { texto: "Terminó", tono: "border-emerald-400/60 bg-emerald-50/50" }, error: { texto: "Falló", tono: "border-rose-400/60 bg-rose-50/50" },
  failed: { texto: "Falló", tono: "border-rose-400/60 bg-rose-50/50" }, cancelled: { texto: "Cancelada", tono: "border-border/60 opacity-70" },
};
export const tamano = (b: number): string => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
