/** Activa pestaña y rutas del módulo Múuch' (juntas). Build: VITE_MTG_JUNTAS_ENABLED=true */
export function isMtgJuntasEnabled(): boolean {
  const raw = import.meta.env.VITE_MTG_JUNTAS_ENABLED;
  if (raw === undefined || raw === "") return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
