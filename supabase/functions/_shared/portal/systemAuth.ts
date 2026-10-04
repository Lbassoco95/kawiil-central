/**
 * Firma HMAC central → Kawiil OS (y viceversa).
 * Contrato Corte 3: timestamp + nonce + operation + sha256(body).
 */
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function signSystemRequest(
  operation: string,
  body: string,
  secret: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
  nonce = crypto.randomUUID().replaceAll("-", ""),
): Promise<Record<string, string>> {
  const bodyHash = await sha256(body);
  return {
    "x-system-timestamp": timestamp,
    "x-system-nonce": nonce,
    "x-system-operation": operation,
    "x-system-signature": await hmac(
      secret,
      `${timestamp}.${nonce}.${operation}.${bodyHash}`,
    ),
  };
}
