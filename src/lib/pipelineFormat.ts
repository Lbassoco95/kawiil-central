/**
 * Utilidades visuales compartidas del módulo Pipeline v2.5.
 */

import type { PipelineStage } from "@/hooks/usePipeline";

// ─── Moneda ──────────────────────────────────────────────────────────────────

const MXN_FORMATTER = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

/**
 * Formatea MXN de forma compacta: $45K, $1.2M, $850, "—" si null/undefined.
 */
export function formatMxn(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const compact = opts?.compact ?? true;
  if (!compact) return MXN_FORMATTER.format(n);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    const digits = abs >= 10_000_000 ? 1 : abs >= 1_000_000 ? 1 : 2;
    return `$${v.toFixed(digits)}M MXN`;
  }
  if (abs >= 1_000) {
    const v = n / 1_000;
    return `$${Math.round(v)}K MXN`;
  }
  return MXN_FORMATTER.format(n);
}

/**
 * Formato corto sin sufijo MXN (para chips pequeños): $45K, $1.2M.
 */
export function formatMxnShort(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    const digits = abs >= 10_000_000 ? 1 : 1;
    return `$${v.toFixed(digits)}M`;
  }
  if (abs >= 1_000) {
    return `$${Math.round(n / 1_000)}K`;
  }
  return `$${n.toFixed(0)}`;
}

// ─── Banderas ────────────────────────────────────────────────────────────────

const FLAG_BY_CODE: Record<string, string> = {
  MX: "🇲🇽",
  US: "🇺🇸",
  USA: "🇺🇸",
  CA: "🇨🇦",
  CL: "🇨🇱",
  CO: "🇨🇴",
  AR: "🇦🇷",
  EC: "🇪🇨",
  PE: "🇵🇪",
  CR: "🇨🇷",
  ES: "🇪🇸",
  PA: "🇵🇦",
  BO: "🇧🇴",
  VE: "🇻🇪",
  UY: "🇺🇾",
  PY: "🇵🇾",
  GT: "🇬🇹",
  HN: "🇭🇳",
  SV: "🇸🇻",
  NI: "🇳🇮",
  DO: "🇩🇴",
  PR: "🇵🇷",
  BR: "🇧🇷",
};

/**
 * Devuelve el emoji bandera para un ISO alpha-2 (o "USA", "US/CA"). Fallback 🌎.
 */
export function flagForCountry(code: string | null | undefined): string {
  if (!code) return "🌎";
  const upper = code.trim().toUpperCase();
  if (FLAG_BY_CODE[upper]) return FLAG_BY_CODE[upper];
  // "US/CA" style
  if (upper.includes("/")) {
    const first = upper.split("/")[0];
    if (FLAG_BY_CODE[first]) return FLAG_BY_CODE[first];
  }
  // Derivar bandera de dos letras vía regional indicators
  if (/^[A-Z]{2}$/.test(upper)) {
    const A = 0x1f1e6;
    const base = "A".charCodeAt(0);
    return String.fromCodePoint(A + (upper.charCodeAt(0) - base), A + (upper.charCodeAt(1) - base));
  }
  return "🌎";
}

// ─── Tiempo relativo ─────────────────────────────────────────────────────────

/**
 * Tiempo relativo en español con capitalización natural:
 * "Hace 5 min", "Hace 2h", "Ayer 17:45", "Hace 4d", "12 abr".
 */
export function relativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 0) {
    // Futuro cercano
    const abs = Math.abs(diffSec);
    if (abs < 3600) return `En ${Math.max(1, Math.round(abs / 60))} min`;
    if (abs < 86400) return `En ${Math.round(abs / 3600)}h`;
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  }
  if (diffSec < 60) return "Hace unos segundos";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH}h`;
  // Ayer (mismo día calendario)
  const yday = new Date(now);
  yday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yday.getFullYear() &&
    d.getMonth() === yday.getMonth() &&
    d.getDate() === yday.getDate()
  ) {
    const hh = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `Ayer ${hh}`;
  }
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `Hace ${diffD}d`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

// ─── Pills de etapa ──────────────────────────────────────────────────────────

/**
 * Devuelve `style` inline (background + text color derivados del stage.color) para un pill de etapa.
 * Compatible con dark mode gracias al alpha en background.
 */
export function stageBadgeStyle(stage: Pick<PipelineStage, "color"> | null | undefined): React.CSSProperties {
  const color = stage?.color ?? "#64748B";
  return {
    backgroundColor: hexToRgba(color, 0.14),
    color,
    borderColor: hexToRgba(color, 0.4),
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const bigint = parseInt(
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean,
    16,
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Score ───────────────────────────────────────────────────────────────────

export function scoreDotColor(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 80) return "#EF4444"; // rojo caliente
  if (s >= 60) return "#F97316"; // naranja
  if (s >= 40) return "#EAB308"; // amarillo
  return "#94A3B8"; // gris
}

// ─── Avatar iniciales ────────────────────────────────────────────────────────

export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Color de fondo determinístico para avatar según nombre (hash simple).
 */
export function avatarBgFromName(name: string | null | undefined): string {
  if (!name) return "#94A3B8";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const palette = [
    "#6366F1", // indigo
    "#8B5CF6", // violet
    "#EC4899", // pink
    "#F59E0B", // amber
    "#10B981", // emerald
    "#0EA5E9", // sky
    "#EF4444", // red
    "#14B8A6", // teal
  ];
  return palette[hash % palette.length];
}

// ─── CTA contextual por etapa (tablero) ──────────────────────────────────────

export function stageCta(slug: string | null | undefined): string {
  switch (slug) {
    case "registrado":
      return "Saludar por correo";
    case "contactado":
      return "Enviar Follow-up 1";
    case "calificado":
      return "Enviar propuesta";
    case "propuesta":
      return "Llamar a cliente";
    case "negociacion":
      return "Cerrar trato";
    case "frio":
      return "Reactivar";
    case "perdido":
      return "Revisar motivo";
    case "convertido":
      return "Iniciar onboarding";
    default:
      return "Siguiente acción";
  }
}
