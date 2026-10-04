import { isDesignPreview } from "./designPreview";

/** Prefijo de rutas cuando la sesión es solo vista de diseño. */
export function portalBase(): string {
  return isDesignPreview() ? "/diseno" : "";
}

export function portalPath(path: string): string {
  const base = portalBase();
  if (!path || path === "/") return base || "/";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
