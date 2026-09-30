/**
 * AES-GCM compatible con supabase/functions/_shared/moffinFielCrypto.ts
 * (llave = SHA-256 del secreto; IV de 12 bytes al inicio; todo en base64).
 * Lo usa la rotación de secretos del CSD. Nunca registra texto en claro.
 */
const enc = new TextEncoder();
async function key(secret) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", d, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encrypt(plain, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return Buffer.from(out).toString("base64");
}
export async function decrypt(b64, secret) {
  const all = new Uint8Array(Buffer.from(b64, "base64"));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await key(secret), all.slice(12));
  return new TextDecoder().decode(plain);
}
export async function reencrypt(b64, oldSecret, newSecret) {
  return encrypt(await decrypt(b64, oldSecret), newSecret);
}
