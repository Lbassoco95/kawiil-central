import type { Pose } from "./types";

export const POSE_SRC: Record<Pose, string> = {
  saluda: "/portal/kawiilito/kawiilito-saluda.png",
  listo: "/portal/kawiilito/kawiilito-saluda-pulgar.png",
  cifras: "/portal/kawiilito/kawiilito-calculadora.png",
  duda: "/portal/kawiilito/kawiilito-piensa.png",
  datos: "/portal/kawiilito/kawiilito-tablet.png",
  pendientes: "/portal/kawiilito/kawiilito-libreta.png",
};

/** Pack identidad Kawiil OS v1 → public/brand/kawiil-os/ */
const BRAND = "/brand/kawiil-os";

export const LOGO = {
  horizontalBlue: `${BRAND}/logo-horizontal-blue.svg`,
  horizontalWhite: `${BRAND}/logo-horizontal-white.svg`,
  horizontalNavy: `${BRAND}/logo-horizontal-navy.svg`,
  symbolBlue: `${BRAND}/symbol-blue.svg`,
  symbolWhite: `${BRAND}/symbol-white.svg`,
  symbolNavy: `${BRAND}/symbol-navy.svg`,
  wordBlue: `${BRAND}/wordmark-blue.svg`,
  wordWhite: `${BRAND}/wordmark-white.svg`,
  wordNavy: `${BRAND}/wordmark-navy.svg`,
  /** Compat: mark = isotipo */
  markBlue: `${BRAND}/symbol-blue.svg`,
  markWhite: `${BRAND}/symbol-white.svg`,
} as const;

export function money(n: number | null | undefined, cents = false): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}

export function deltaWords(delta?: number): string | null {
  if (delta == null || Number.isNaN(delta)) return null;
  const abs = Math.abs(delta).toFixed(1);
  if (delta > 0) return `Sube ${abs}%`;
  if (delta < 0) return `Baja ${abs}%`;
  return "Sin cambio";
}
