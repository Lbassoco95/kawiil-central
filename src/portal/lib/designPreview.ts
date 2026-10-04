/** Vista de diseño sin sesión (para capturas y revisión Polo). */
export function isDesignPreview(): boolean {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    if (q.get("diseno") === "1" || q.get("vista") === "diseno") return true;
    if (window.location.pathname.startsWith("/diseno")) return true;
  }
  return String(import.meta.env.VITE_PORTAL_DESIGN_PREVIEW ?? "").trim().toLowerCase() === "true";
}
