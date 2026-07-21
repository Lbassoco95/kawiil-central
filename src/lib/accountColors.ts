import { useCallback } from "react";
import { useCalendarPrefs } from "@/hooks/useCalendarPrefs";

/**
 * Colores por cuenta COMPARTIDOS entre Calendario y Correo.
 * El usuario configura estos colores en el Calendario (localStorage `kawiil-cal-account-colors`
 * + BD `user_calendar_prefs.accountColors`, sincronizado entre dispositivos). El Correo los
 * reutiliza para que cada cuenta tenga el mismo color en ambos módulos.
 *
 * Claves: `microsoft-primary` para el buzón principal Kawiil; `linked_accounts.id` para las demás.
 */
export const ACCOUNT_COLORS = ["#22c55e", "#f97316", "#a855f7", "#0ea5e9", "#ec4899", "#eab308", "#ef4444", "#8b5cf6"];

/** ID de la cuenta principal (buzón que vive en microsoft_tokens). */
export const PRIMARY_MS_ID = "microsoft-primary";

/** Color por defecto de la cuenta principal (teal Kawiil), editable en el Calendario. */
export const PRIMARY_MS_COLOR = "#0099bc";

/** Color por defecto derivado del ID de la cuenta (hash estable sobre la paleta fija). */
export function accountColorFor(accountId?: string | null): string {
  if (!accountId) return ACCOUNT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) hash = (hash * 31 + accountId.charCodeAt(i)) & 0xffffffff;
  return ACCOUNT_COLORS[Math.abs(hash) % ACCOUNT_COLORS.length];
}

function readLocalAccountColors(): Record<string, string> {
  try { return JSON.parse(window.localStorage.getItem("kawiil-cal-account-colors") || "{}"); } catch { return {}; }
}

/**
 * Devuelve una función `colorForAccount(id)` que resuelve el color de cada cuenta con la MISMA
 * lógica que el Calendario: override del usuario (BD → localStorage) o el color por defecto.
 * `id` vacío/undefined = cuenta principal Kawiil.
 */
export function useAccountColor(): (accountId?: string | null) => string {
  const { data: dbPrefs } = useCalendarPrefs();
  const dbColors = dbPrefs?.accountColors;
  return useCallback((accountId?: string | null) => {
    const id = accountId && accountId.length > 0 ? accountId : PRIMARY_MS_ID;
    const overrides = { ...readLocalAccountColors(), ...(dbColors ?? {}) };
    if (overrides[id]) return overrides[id];
    return id === PRIMARY_MS_ID ? PRIMARY_MS_COLOR : accountColorFor(id);
  }, [dbColors]);
}
