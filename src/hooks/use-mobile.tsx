import * as React from "react";

/** Umbral alineado con layouts responsive (`sm` tailwind ≈ tablet). */
export const MOBILE_BREAKPOINT_PX = 768;

const MOBILE_MQL = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;

/** Lectura imperativa (p. ej. al hacer clic en «Abrir») sin depender del cierre de `useIsMobile`. */
export function matchesMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MQL).matches;
}

function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia(MOBILE_MQL);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_MQL).matches;
}

function getMobileServerSnapshot() {
  return false;
}

/**
 * Viewport «compacto» (modal/dialog). Usa `useSyncExternalStore` para que el valor coincida
 * con `matchMedia` en cada render y no haya desfase vs `matchesMobileViewport()`.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribeMobile, getMobileSnapshot, getMobileServerSnapshot);
}
