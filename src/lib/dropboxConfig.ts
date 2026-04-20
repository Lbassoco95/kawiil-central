/**
 * Configuración compartida del integrador Dropbox del despacho.
 *
 * `KAWIIL_TEAM_ROOT` es la carpeta raíz del equipo en Dropbox que cuelga
 * del Team Space (no del usuario personal). Por defecto apunta a
 * `/Kawiil Mx` que es el namespace original del despacho. Se puede
 * sobreescribir en build/deploy con la variable `VITE_KAWIIL_TEAM_ROOT`
 * sin tocar código (útil cuando se reorganiza Dropbox o se opera bajo
 * otro espacio de equipo).
 *
 * Nota: la Edge Function `dropbox-browse` también tiene su propio default
 * server-side; si cambias este valor para producción, valida que ambos
 * lados estén alineados.
 */
const RAW =
  (typeof import.meta !== "undefined"
    ? (import.meta as ImportMeta).env?.VITE_KAWIIL_TEAM_ROOT
    : undefined) ?? "/Kawiil Mx";

/** Ruta absoluta (con `/` inicial) del root de equipo en Dropbox. */
export const KAWIIL_TEAM_ROOT: string = (() => {
  const trimmed = String(RAW).trim();
  if (!trimmed) return "/Kawiil Mx";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
})();

/** Nombre legible del root de equipo (para badges/labels en UI). */
export const KAWIIL_TEAM_ROOT_NAME: string =
  KAWIIL_TEAM_ROOT.split("/").filter(Boolean).pop() ?? "Kawiil Mx";

/**
 * Devuelve una subruta dentro del team root, normalizando barras.
 * Ej: `kawiilTeamPath('CLIENTES', 'ACME')` → `/Kawiil Mx/CLIENTES/ACME`.
 */
export function kawiilTeamPath(...segments: string[]): string {
  const tail = segments
    .filter(Boolean)
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return tail ? `${KAWIIL_TEAM_ROOT}/${tail}` : KAWIIL_TEAM_ROOT;
}
