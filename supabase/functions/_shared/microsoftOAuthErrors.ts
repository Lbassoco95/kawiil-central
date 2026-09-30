/**
 * Clasifica errores OAuth de Azure AD / Microsoft identity platform
 * (token refresh, authorization_code exchange).
 */

export const MICROSOFT_AUTH_CONFIG_EXPIRED_MSG =
  "El client secret en Supabase no es válido para Azure (app db370917…). " +
  "En Azure Portal → Certificates & secrets copia el Value del secreto vigente " +
  "(NO el Secret ID) y pégalo igual en MICROSOFT_CLIENT_SECRET y AZURE_CLIENT_SECRET " +
  "(proyecto qppfampapbxdgednkofc → Edge Functions → Secrets).";

export const MICROSOFT_SECRET_INVALID_MSG =
  "Azure rechazó el client secret (AADSTS7000215): suele ser el Secret ID en lugar del Value, " +
  "o un Value truncado. Copia el Value completo del secreto nuevo y actualiza " +
  "MICROSOFT_CLIENT_SECRET y AZURE_CLIENT_SECRET en Supabase.";

export const MICROSOFT_RECONNECT_REQUIRED_MSG =
  "Tu sesión de Microsoft expiró o fue revocada. Reconecta Microsoft 365 desde el calendario o Configuración.";

export type MicrosoftOAuthErrorClass = {
  code: "AUTH_CONFIG_EXPIRED" | "SECRET_INVALID" | "RECONNECT_REQUIRED";
  message: string;
};

function asText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

/** Detecta secret caducado / inválido vs refresh_token inválido. */
export function classifyMicrosoftOAuthError(raw: unknown): MicrosoftOAuthErrorClass | null {
  const text = asText(raw);
  const lower = text.toLowerCase();

  if (
    lower.includes("aadsts7000222") ||
    (lower.includes("client secret keys") && lower.includes("expired"))
  ) {
    return { code: "AUTH_CONFIG_EXPIRED", message: MICROSOFT_AUTH_CONFIG_EXPIRED_MSG };
  }

  if (
    lower.includes("aadsts7000215") ||
    (lower.includes("invalid client secret") && lower.includes("secret id"))
  ) {
    return { code: "SECRET_INVALID", message: MICROSOFT_SECRET_INVALID_MSG };
  }

  if (
    lower.includes("invalid_client") &&
    (lower.includes("expired") || lower.includes("secret") || lower.includes("aadsts70002"))
  ) {
    return { code: "AUTH_CONFIG_EXPIRED", message: MICROSOFT_AUTH_CONFIG_EXPIRED_MSG };
  }

  // Refresh token / consentimiento revocado — el usuario debe reconectar
  if (
    lower.includes("invalid_grant") ||
    lower.includes("aadsts70000") ||
    lower.includes("aadsts50173") ||
    lower.includes("aadsts700082") ||
    lower.includes("aadsts9002313")
  ) {
    return { code: "RECONNECT_REQUIRED", message: MICROSOFT_RECONNECT_REQUIRED_MSG };
  }

  return null;
}

/** Prefijo para el catch de microsoft-api (mismo patrón que MICROSOFT_PERMISSION_REQUIRED). */
export function throwMicrosoftOAuthError(raw: unknown, fallbackPrefix = "Token refresh failed"): never {
  const classified = classifyMicrosoftOAuthError(raw);
  if (classified) {
    throw new Error(`MICROSOFT_${classified.code}:${classified.message}`);
  }
  throw new Error(`${fallbackPrefix}: ${asText(raw)}`);
}
