/**
 * Autenticación del plano de control: MATI API (servidor a servidor) → Kawiil.
 *
 * Dos capas, ambas obligatorias:
 *   1. Credencial: `Authorization: Bearer <SEGURIDAD_CONTROL_TOKEN>` (≥ 32 caracteres).
 *   2. Firma HMAC-SHA256 de cada petición con `SEGURIDAD_CONTROL_HMAC_KEY` (≥ 32 caracteres,
 *      distinta del token), con ventana de ±5 min y nonce de un solo uso.
 *
 * Cabeceras de la firma:
 *   x-control-timestamp   segundos Unix
 *   x-control-nonce       UUID de un solo uso
 *   x-control-signature   hex( HMAC-SHA256(clave, `${timestamp}.${nonce}.${MÉTODO}.${sha256hex(cuerpo)}`) )
 * El cuerpo entra en la firma, así que cambiar la acción o los parámetros invalida la petición.
 *
 * Rotación: se aceptan dos valores a la vez (`*_PREVIOUS`) para cambiar la credencial sin cortar el servicio.
 */

export type ControlConfig = { tokens: string[]; hmacKeys: string[]; problems: string[] };

const MIN_CREDENTIAL_LENGTH = 32;
const SIGNATURE_WINDOW_SECONDS = 300;
const enc = new TextEncoder();

type Env = (name: string) => string | undefined;

export function loadControlConfig(env: Env): ControlConfig {
  const long = (name: string) => {
    const v = (env(name) ?? "").trim();
    return v.length >= MIN_CREDENTIAL_LENGTH ? v : "";
  };
  const tokens = [long("SEGURIDAD_CONTROL_TOKEN"), long("SEGURIDAD_CONTROL_TOKEN_PREVIOUS")].filter(Boolean);
  const hmacKeys = [long("SEGURIDAD_CONTROL_HMAC_KEY"), long("SEGURIDAD_CONTROL_HMAC_KEY_PREVIOUS")].filter(Boolean);
  const problems: string[] = [];
  if (!tokens.length) problems.push("SEGURIDAD_CONTROL_TOKEN (≥ 32 caracteres)");
  if (!hmacKeys.length) problems.push("SEGURIDAD_CONTROL_HMAC_KEY (≥ 32 caracteres)");
  // Una misma cadena como credencial y como clave de firma anularía la segunda capa.
  if (tokens.some((t) => hmacKeys.includes(t))) problems.push("el token y la clave de firma deben ser distintos");
  return { tokens, hmacKeys, problems };
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

/** Comparación en tiempo constante: compara los SHA-256, no el texto crudo. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** ¿La credencial del `Authorization: Bearer` coincide con alguna vigente? Recorre todas. */
export async function tokenOk(req: Request, tokens: string[]): Promise<boolean> {
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  let found = false;
  for (const t of tokens) if (await safeEqual(bearer, t)) found = true;
  return found;
}

export type SignatureResult = { ok: true } | { ok: false; reason: "missing" | "format" | "expired" | "bad_signature" | "replay" };

/** El nonce solo se consume cuando la firma es válida (nadie sin la clave puede llenar la tabla). */
export async function verifyControlSignature(o: {
  method: string;
  bodyText: string;
  headers: Headers;
  keys: string[];
  nowSec: number;
  /** true si el nonce era nuevo; false si ya se había usado. Puede lanzar si el almacén falla. */
  consumeNonce: (nonce: string) => Promise<boolean>;
  windowSec?: number;
}): Promise<SignatureResult> {
  const ts = o.headers.get("x-control-timestamp") ?? "";
  const nonce = o.headers.get("x-control-nonce") ?? "";
  const sig = o.headers.get("x-control-signature") ?? "";
  if (!ts || !nonce || !sig) return { ok: false, reason: "missing" };
  if (!/^\d{9,12}$/.test(ts) || !/^[0-9A-Za-z-]{16,64}$/.test(nonce) || !/^[0-9a-fA-F]{64}$/.test(sig)) {
    return { ok: false, reason: "format" };
  }
  if (Math.abs(o.nowSec - Number(ts)) > (o.windowSec ?? SIGNATURE_WINDOW_SECONDS)) return { ok: false, reason: "expired" };

  const message = `${ts}.${nonce}.${o.method.toUpperCase()}.${await sha256Hex(o.bodyText)}`;
  let match = false;
  for (const key of o.keys) if (await safeEqual(await hmacHex(key, message), sig.toLowerCase())) match = true;
  if (!match) return { ok: false, reason: "bad_signature" };
  if (!(await o.consumeNonce(nonce))) return { ok: false, reason: "replay" };
  return { ok: true };
}

/** El actor lo declara el llamador; se fuerza el prefijo `mati:` para que la bitácora distinga su origen. */
export function bindActor(raw: string | null): string {
  const v = (raw ?? "").trim().slice(0, 120);
  return v.startsWith("mati:") && v.length > 5 ? v : "mati:(sin actor)";
}
