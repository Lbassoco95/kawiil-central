/**
 * `state` de OAuth firmado y con caducidad.
 *
 * Antes el `state` era el UUID del usuario (o JSON en base64 sin firma): quien
 * conociera el UUID de otra persona podía iniciar el flujo con ese `state` y
 * vincular SU cuenta de Slack/Microsoft/Google a la de esa persona.
 *
 * Ahora solo las funciones `*-auth` (que exigen la sesión del usuario) pueden
 * emitir un `state` válido, y solo para ese usuario:
 *   v1.<payload base64url>.<HMAC-SHA256 base64url>
 * El payload incluye el proveedor (`p`, para que un `state` de Slack no sirva en
 * Google), la caducidad (`exp`, 10 min) y un nonce.
 *
 * Clave: `OAUTH_STATE_SECRET` (≥ 32 caracteres) si existe; si no, se deriva de
 * `SUPABASE_SERVICE_ROLE_KEY` (que ya tienen todas las funciones) sin exponerla.
 *
 * Límite conocido: el `state` no va atado al navegador de quien lo inicia. Un
 * atacante autenticado podría pedir un `state` para SU cuenta y convencer a otra
 * persona de completar el consentimiento; lo mitiga la pantalla de consentimiento
 * del proveedor, no este módulo.
 */

export type OAuthProvider = "slack" | "microsoft" | "outlook" | "google";

const TTL_SECONDS = 600;
const VERSION = "v1";

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob((input + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(keyBytes: BufferSource, message: BufferSource) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, message));
}

async function signingKey() {
  const enc = new TextEncoder();
  const dedicated = (Deno.env.get("OAUTH_STATE_SECRET") ?? "").trim();
  if (dedicated.length >= 32) return enc.encode(dedicated);
  const base = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!base) throw new Error("No hay clave para firmar el state de OAuth");
  // Derivación con etiqueta: la clave de servicio nunca se usa directamente.
  return await hmac(enc.encode(base), enc.encode("kawiil:oauth-state:v1"));
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Emite un `state` firmado. `payload.u` debe ser el id del usuario autenticado. */
export async function signOAuthState(
  provider: OAuthProvider,
  payload: Record<string, unknown> & { u: string },
  ttlSeconds = TTL_SECONDS,
): Promise<string> {
  const body = {
    ...payload,
    p: provider,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    n: crypto.randomUUID(),
  };
  const enc = new TextEncoder();
  const part = b64urlEncode(enc.encode(JSON.stringify(body)));
  const sig = await hmac(await signingKey(), enc.encode(`${VERSION}.${part}`));
  return `${VERSION}.${part}.${b64urlEncode(sig)}`;
}

/**
 * Verifica firma, proveedor y caducidad. Devuelve el payload o `null` (sin
 * explicar por qué: el motivo no debe ayudar a un atacante).
 */
export async function verifyOAuthState<T extends { u: string }>(
  raw: string | null,
  provider: OAuthProvider,
): Promise<(T & { p: OAuthProvider; exp: number }) | null> {
  try {
    if (!raw) return null;
    const parts = raw.trim().split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    const enc = new TextEncoder();
    const expected = await hmac(await signingKey(), enc.encode(`${VERSION}.${parts[1]}`));
    if (!safeEqual(expected, b64urlDecode(parts[2]))) return null;
    const body = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (!body || typeof body !== "object") return null;
    if (body.p !== provider) return null;
    if (typeof body.exp !== "number" || body.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof body.u !== "string" || !body.u) return null;
    return body;
  } catch {
    return null;
  }
}
