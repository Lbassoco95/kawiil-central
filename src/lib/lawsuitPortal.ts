import { supabase } from "@/integrations/supabase/client";

/**
 * La tabla `project_client_links` aún no está en los tipos generados de Supabase;
 * al regenerar `types.ts` este alias puede reemplazarse por `supabase` a secas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const portalDb = supabase as any;

export interface ProjectClientLink {
  id: string;
  project_id: string;
  active: boolean;
  last_viewed_at: string | null;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Token aleatorio de 192 bits en base64url (32 caracteres). */
export function generatePortalToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Código numérico de 6 dígitos (sin sesgo de módulo). */
export function generatePortalCode(): string {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000);
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

/** Mismo cálculo que la Edge Function `client-portal`: sha256(token:código). */
export function portalCodeHash(token: string, code: string): Promise<string> {
  return sha256Hex(`${token}:${code}`);
}

export function portalUrl(token: string, origin = window.location.origin): string {
  return `${origin}/portal/${token}`;
}
