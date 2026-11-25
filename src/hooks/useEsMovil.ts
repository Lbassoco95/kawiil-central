import { useEffect, useState } from "react";

// ¿Pantalla de celular? (menos de 768 px, el punto `md` de Tailwind). R7: la versión móvil cambia el orden (lista primero), abre el chat a pantalla completa y no ofrece
// «Varios a la vez». Sin `matchMedia` (pruebas, servidor) se asume pantalla ancha.
export const PUNTO_MOVIL = "(max-width: 767px)";
export function useEsMovil(): boolean {
  const leer = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PUNTO_MOVIL).matches : false);
  const [movil, setMovil] = useState(leer);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(PUNTO_MOVIL), f = () => setMovil(m.matches);
    f(); m.addEventListener?.("change", f);
    return () => m.removeEventListener?.("change", f);
  }, []);
  return movil;
}
