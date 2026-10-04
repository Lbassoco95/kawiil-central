import type { Pose } from "./types";

export const POSE_SRC: Record<Pose, string> = {
  saluda: "/portal/kawiilito/kawiilito-saluda.png",
  listo: "/portal/kawiilito/kawiilito-saluda-pulgar.png",
  cifras: "/portal/kawiilito/kawiilito-calculadora.png",
  duda: "/portal/kawiilito/kawiilito-piensa.png",
  datos: "/portal/kawiilito/kawiilito-tablet.png",
  pendientes: "/portal/kawiilito/kawiilito-libreta.png",
};

export const LOGO = {
  markBlue: "/portal/logo/kawiil-logo-blue.png",
  markWhite: "/portal/logo/kawiil-logo-white.png",
  wordBlue: "/portal/logo/kawiil-wordmark-blue.png",
  wordWhite: "/portal/logo/kawiil-wordmark-white.png",
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
