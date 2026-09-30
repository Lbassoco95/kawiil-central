/**
 * Cifrado JWE de e.firma para SATgo (RSA-OAEP-256 + A256GCM).
 * Docs: https://sat-go.com/cifrar-efirma
 * Llave: GET /api/v1/secretprovider/fiel-encryption-key
 */
import * as jose from "https://esm.sh/jose@5.9.6";

export type SatgoFielEncKey = {
  kid: string;
  publicKeyPem: string;
  jwk?: Record<string, unknown>;
};

export type SatgoJwePair = {
  keyJwe: string;
  passwordJwe: string;
  kid: string;
};

function satgoBaseUrl(): string {
  return (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(/\/$/, "");
}

export async function fetchSatgoFielEncryptionKey(
  bearer: string,
): Promise<SatgoFielEncKey> {
  const url = `${satgoBaseUrl()}/api/v1/secretprovider/fiel-encryption-key`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(
      `SATgo fiel-encryption-key HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const pem =
    typeof json.publicKeyPem === "string" ? json.publicKeyPem.trim() : "";
  const kid = typeof json.kid === "string" ? json.kid.trim() : "";
  if (!pem || !kid) {
    throw new Error("SATgo fiel-encryption-key sin publicKeyPem/kid");
  }
  return {
    kid,
    publicKeyPem: pem,
    jwk: json.jwk && typeof json.jwk === "object"
      ? (json.jwk as Record<string, unknown>)
      : undefined,
  };
}

async function importSatgoPublicKey(enc: SatgoFielEncKey): Promise<CryptoKey> {
  if (enc.jwk && enc.jwk.kty === "RSA") {
    return jose.importJWK(
      enc.jwk as jose.JWK,
      "RSA-OAEP-256",
    ) as Promise<CryptoKey>;
  }
  return jose.importSPKI(enc.publicKeyPem, "RSA-OAEP-256");
}

async function compactEncrypt(
  plaintext: Uint8Array,
  enc: SatgoFielEncKey,
): Promise<string> {
  const key = await importSatgoPublicKey(enc);
  return new jose.CompactEncrypt(plaintext)
    .setProtectedHeader({
      alg: "RSA-OAEP-256",
      enc: "A256GCM",
      kid: enc.kid,
    })
    .encrypt(key);
}

/** Cifra bytes crudos del .key y la contraseña UTF-8 como JWE independientes. */
export async function encryptFielMaterialToSatgoJwe(
  keyBytes: Uint8Array,
  password: string,
  enc: SatgoFielEncKey,
): Promise<SatgoJwePair> {
  const pwd = password.trim();
  if (!keyBytes.length) throw new Error("llave_vacia");
  if (!pwd) throw new Error("contrasena_vacia");
  const keyJwe = await compactEncrypt(keyBytes, enc);
  const passwordJwe = await compactEncrypt(
    new TextEncoder().encode(pwd),
    enc,
  );
  return { keyJwe, passwordJwe, kid: enc.kid };
}

export function base64FileToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
