import DOMPurify from "dompurify";

/**
 * HTML del cuerpo de un correo listo para `srcDoc` en un iframe con `sandbox`.
 * — Sanitiza (DOMPurify perfil HTML).
 * — Quita objetos/iframes embebidos (riesgo + a menudo muestran “Chrome bloqueó…”).
 * — Fuerza enlaces externos a `target="_blank"` para no navegar dentro del iframe
 *   (muchas URLs rechazan cargarse dentro de iframe).
 */
export function sanitizeEmailBodyForIframe(html: string): string {
  if (!html?.trim()) return "";
  let sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["iframe", "object", "embed", "form"],
  });

  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return sanitized;
  }
  try {
    const doc = new DOMParser().parseFromString(`<div id="__k_wr">${sanitized}</div>`, "text/html");
    const root = doc.getElementById("__k_wr");
    if (!root) return sanitized;
    root.querySelectorAll("a[href]").forEach((el) => {
      const href = el.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    });
    return root.innerHTML;
  } catch {
    return sanitized;
  }
}
