/**
 * Estado OAuth Microsoft embebido en `state` (userId + returnTo + modo + origen).
 * Firmado con HMAC y con caducidad (ver `_shared/oauthState.ts`).
 */

import { signOAuthState, verifyOAuthState } from "./oauthState.ts";

export type MicrosoftOAuthState = {
  u: string;
  /** Ruta relativa de retorno en Kawiil, p. ej. /microsoft365/calendario */
  r?: string;
  /** redirect = navegación completa; popup = window.open + postMessage */
  m?: "redirect" | "popup";
  /** Origen allowlisted del front (https://www.kawiil-central.mx, Lovable, etc.) */
  o?: string;
};

const ALLOWED_ORIGINS = new Set([
  "https://www.kawiil-central.mx",
  "https://kawiil-central.mx",
  "https://kawiil-core-hub.lovable.app",
]);

/** `state` firmado (HMAC + caducidad). Ver `_shared/oauthState.ts`. */
export async function encodeMicrosoftOAuthState(state: MicrosoftOAuthState): Promise<string> {
  return await signOAuthState("microsoft", state);
}

/**
 * Devuelve el estado solo si la firma, el proveedor y la caducidad son válidos.
 * Ya NO se acepta el UUID de usuario "legado": cualquiera podía fabricarlo.
 */
export async function parseMicrosoftOAuthState(raw: string | null): Promise<MicrosoftOAuthState | null> {
  const v = await verifyOAuthState<MicrosoftOAuthState>(raw, "microsoft");
  if (!v) return null;
  return { u: v.u, r: v.r, m: v.m, o: v.o };
}

/** Solo rutas internas relativas (anti open-redirect). */
export function sanitizeReturnPath(path: unknown, fallback = "/microsoft365/calendario"): string {
  if (typeof path !== "string") return fallback;
  const p = path.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("://")) return fallback;
  if (p.length > 500) return fallback;
  return p;
}

export function sanitizeAppOrigin(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  const o = origin.trim().replace(/\/$/, "");
  if (ALLOWED_ORIGINS.has(o)) return o;
  // Preview Lovable / Vercel / localhost en desarrollo
  try {
    const u = new URL(o);
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return `${u.protocol}//${u.host}`;
    }
    if (u.protocol === "https:" && (u.hostname.endsWith(".lovable.app") || u.hostname.endsWith(".vercel.app"))) {
      return `${u.protocol}//${u.host}`;
    }
  } catch {
    return null;
  }
  return null;
}

/** Preferencia: origen del cliente (allowlisted) → KAWIIL_APP_URL → producción. */
export function appOrigin(preferred?: string | null): string {
  const fromClient = sanitizeAppOrigin(preferred);
  if (fromClient) return fromClient;

  const fromEnv = (Deno.env.get("KAWIIL_APP_URL") || "").trim().replace(/\/$/, "");
  const fromEnvOk = sanitizeAppOrigin(fromEnv);
  if (fromEnvOk) return fromEnvOk;

  // SITE_URL a veces apunta a Lovable; no usarlo como default de producción.
  return "https://www.kawiil-central.mx";
}

export function buildAppReturnUrl(
  returnPath: string,
  query: Record<string, string>,
  preferredOrigin?: string | null,
): string {
  const path = sanitizeReturnPath(returnPath);
  const url = new URL(path, appOrigin(preferredOrigin));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}
