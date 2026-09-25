/**
 * Mensajes de error accionables para fallos de Microsoft Graph / OAuth
 * (calendario, correo, conexión).
 */

const AUTH_CONFIG_EXPIRED_MSG =
  "La integración con Microsoft está caída: el client secret de Azure expiró. Un administrador debe renovarlo en Azure Portal (app db370917…) y actualizar MICROSOFT_CLIENT_SECRET en Supabase → Edge Functions → Secrets.";

const RECONNECT_REQUIRED_MSG =
  "Tu sesión de Microsoft expiró. Reconecta Microsoft 365 desde el calendario o Configuración.";

function mergeErrorText(err: unknown, errBody?: string): string {
  const parts: string[] = [];
  if (err instanceof Error && err.message) parts.push(err.message);
  else if (typeof err === "string") parts.push(err);
  else if (err && typeof err === "object" && "message" in err) {
    parts.push(String((err as { message?: unknown }).message || ""));
  }
  if (errBody) parts.push(errBody);
  return parts.filter(Boolean).join(" ");
}

function codeFromErrBody(errBody?: string): string {
  if (!errBody) return "";
  try {
    const parsed = JSON.parse(errBody) as { code?: unknown; error?: unknown };
    return typeof parsed.code === "string" ? parsed.code : "";
  } catch {
    return "";
  }
}

function messageFromErrBody(errBody?: string): string {
  if (!errBody) return "";
  try {
    const parsed = JSON.parse(errBody) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : "";
  } catch {
    return "";
  }
}

/** Normaliza errores de microsoft-api / OAuth Azure a un texto corto para toasts. */
export function formatMicrosoftIntegrationError(err: unknown, errBody?: string): string {
  const code = codeFromErrBody(errBody);
  const bodyMsg = messageFromErrBody(errBody);
  const merged = mergeErrorText(err, errBody).toLowerCase();

  if (
    code === "AUTH_CONFIG_EXPIRED" ||
    merged.includes("auth_config_expired") ||
    merged.includes("aadsts7000222") ||
    (merged.includes("invalid_client") &&
      (merged.includes("expired") || merged.includes("client secret")))
  ) {
    return bodyMsg && bodyMsg.includes("client secret") ? bodyMsg : AUTH_CONFIG_EXPIRED_MSG;
  }

  if (
    code === "RECONNECT_REQUIRED" ||
    code === "NOT_CONNECTED" ||
    merged.includes("reconnect_required") ||
    merged.includes("not_connected") ||
    merged.includes("microsoft not connected")
  ) {
    return bodyMsg || RECONNECT_REQUIRED_MSG;
  }

  if (code === "PERMISSION_REQUIRED" || merged.includes("permission_required")) {
    return bodyMsg || "Faltan permisos de Microsoft. Reconecta tu cuenta de Microsoft 365.";
  }

  if (
    code === "GRAPH_THROTTLED" ||
    merged.includes("graph_throttled") ||
    merged.includes("mailboxconcurrency") ||
    merged.includes("applicationthrottled")
  ) {
    return bodyMsg || "Microsoft aplicó un límite temporal al buzón. Espera unos segundos y vuelve a intentar.";
  }

  if (bodyMsg) return bodyMsg;
  if (err instanceof Error && err.message) return err.message;
  return String(err || "Error de Microsoft 365");
}
