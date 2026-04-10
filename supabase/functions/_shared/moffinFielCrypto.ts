/**
 * Cifrado AES-256-GCM para material FIEL en reposo (solo .cer/.key en base64 del archivo).
 * La contraseña de la llave no se persiste; se envía a Moffin solo en cada consulta.
 */

const encoder = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
    );
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptFielSecret(plainText: string, secret: string): Promise<string> {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText)),
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return bytesToBase64(combined);
}

export async function decryptFielSecret(cipherB64: string, secret: string): Promise<string> {
  const combined = base64ToBytes(cipherB64);
  if (combined.length < 13) throw new Error("ciphertext_invalid");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const key = await deriveAesKey(secret);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}

export async function sha256HexFromBase64File(b64: string): Promise<string> {
  const bytes = base64ToBytes(b64);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Valor enviado a Moffin: base64 del archivo tal cual, o texto PEM (utf8 tras decodificar base64). */
export function formatFielMaterial(
  storedBase64: string,
  format: "b64" | "utf8",
): string {
  if (format === "b64") return storedBase64;
  const bytes = base64ToBytes(storedBase64);
  return new TextDecoder().decode(bytes);
}
