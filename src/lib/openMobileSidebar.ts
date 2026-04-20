/** Evento global para abrir el sidebar móvil desde cualquier parte del shell. */
export const OPEN_MOBILE_SIDEBAR_EVENT = "kawiil:open-mobile-sidebar";

export function openMobileSidebar() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_MOBILE_SIDEBAR_EVENT));
}
