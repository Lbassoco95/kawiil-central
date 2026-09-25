/**
 * Estado OAuth Microsoft embebido en `state` (userId + returnTo + modo).
 * Compatible con state legado = solo UUID de usuario.
 */

export type MicrosoftOAuthState = {
  u: string;
  /** Ruta relativa de retorno en Kawiil, p. ej. /microsoft365/calendario */
  r?: string;
  /** redirect = navegación completa; popup = window.open + postMessage */
  m?: "redirect" | "popup";
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function b64urlEncode(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): string {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeMicrosoftOAuthState(state: MicrosoftOAuthState): string {
  return b64urlEncode(JSON.stringify(state));
}

export function parseMicrosoftOAuthState(raw: string | null): MicrosoftOAuthState | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (UUID_RE.test(trimmed)) return { u: trimmed, m: "popup" };
  try {
    const parsed = JSON.parse(b64urlDecode(trimmed)) as MicrosoftOAuthState;
    if (!parsed?.u || typeof parsed.u !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Solo rutas internas relativas (anti open-redirect). */
export function sanitizeReturnPath(path: unknown, fallback = "/microsoft365/calendario"): string {
  if (typeof path !== "string") return fallback;
  const p = path.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("://")) return fallback;
  if (p.length > 500) return fallback;
  return p;
}

export function appOrigin(): string {
  const fromEnv = (Deno.env.get("KAWIIL_APP_URL") || Deno.env.get("SITE_URL") || "")
    .trim()
    .replace(/\/$/, "");
  if (fromEnv.startsWith("http://") || fromEnv.startsWith("https://")) return fromEnv;
  return "https://www.kawiil-central.mx";
}

export function buildAppReturnUrl(returnPath: string, query: Record<string, string>): string {
  const path = sanitizeReturnPath(returnPath);
  const url = new URL(path, appOrigin());
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}
