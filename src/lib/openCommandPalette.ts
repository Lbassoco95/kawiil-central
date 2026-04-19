/** Evento global para abrir el command palette (⌘K). */
export const OPEN_COMMAND_PALETTE_EVENT = "kawiil:open-command-palette";

export function openCommandPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
}
