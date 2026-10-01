/**
 * Consentimiento de administrador (Microsoft Entra) y salida HTML segura
 * para los callbacks OAuth de Microsoft.
 */

export const ADMIN_CONSENT_REQUIRED = "admin_consent_required";
export const ADMIN_CONSENT_STATE = "admin_consent";

/** Scopes delegados de cuentas Outlook (mismos que pide outlook-account-auth). */
export const OUTLOOK_DELEGATED_SCOPES = [
  "openid", "profile", "email", "offline_access",
  "Calendars.ReadWrite", "User.Read",
  "Mail.Read", "Mail.ReadWrite", "Mail.Send", "MailboxSettings.ReadWrite",
];

const OIDC_SCOPES = new Set(["openid", "profile", "email", "offline_access"]);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON apto para incrustar dentro de un <script> (no permite cerrar la etiqueta). */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export type MicrosoftCallbackError = {
  error: string | null;
  errorDescription: string | null;
  errorSubcode: string | null;
};

export function readMicrosoftCallbackError(params: URLSearchParams): MicrosoftCallbackError {
  return {
    error: params.get("error"),
    errorDescription: params.get("error_description"),
    errorSubcode: params.get("error_subcode"),
  };
}

export function isAdminConsentRequired(e: MicrosoftCallbackError): boolean {
  const text = [e.error, e.errorDescription, e.errorSubcode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  if (
    text.includes("aadsts90094") ||
    text.includes("aadsts65001") ||
    text.includes("consent_required") ||
    text.includes("admin_consent_required")
  ) {
    return true;
  }
  return text.includes("access_denied") && /admin/.test(text);
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Tenant válido (GUID o dominio) o null. "common"/"organizations"/"consumers" no son tenants concretos. */
export function normalizeTenant(raw: string | null | undefined): string | null {
  const t = (raw || "").trim().toLowerCase();
  if (!t || t === "common" || t === "organizations" || t === "consumers") return null;
  if (GUID_RE.test(t) || DOMAIN_RE.test(t)) return t;
  return null;
}

export function tenantFromEmail(email: string | null | undefined): string | null {
  const e = (email || "").trim();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return null;
  return normalizeTenant(e.slice(at + 1));
}

/** Enlace v2.0/adminconsent con scopes delegados explícitos (nunca /.default). */
export function buildAdminConsentUrl(opts: {
  tenant: string | null;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
}): string {
  const tenant = normalizeTenant(opts.tenant) || "organizations";
  const scope = (opts.scopes || OUTLOOK_DELEGATED_SCOPES)
    .map((s) => (OIDC_SCOPES.has(s) ? s : `https://graph.microsoft.com/${s}`))
    .join(" ");
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/adminconsent?` +
    new URLSearchParams({
      client_id: opts.clientId,
      scope,
      redirect_uri: opts.redirectUri,
      state: ADMIN_CONSENT_STATE,
    }).toString();
}

/** Regreso de v2.0/adminconsent: admin_consent=True (Microsoft usa "True"). */
export function isAdminConsentGranted(params: URLSearchParams): boolean {
  return (params.get("admin_consent") || "").toLowerCase() === "true";
}
