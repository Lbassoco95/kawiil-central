const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export interface SignedRequest {
  timestamp: string;
  nonce: string;
  operation: string;
  body: string;
  signature: string;
}

export async function verifySystemRequest(request: SignedRequest, secret: string, now = Date.now()): Promise<{ ok: true; requestHash: string } | { ok: false; code: string }> {
  const seconds = Number(request.timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) return { ok: false, code: "timestamp_invalid" };
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(request.nonce)) return { ok: false, code: "nonce_invalid" };
  const bodyHash = await sha256(request.body);
  const expected = await hmac(secret, `${request.timestamp}.${request.nonce}.${request.operation}.${bodyHash}`);
  if (!constantTimeEqual(expected, request.signature.toLowerCase())) return { ok: false, code: "signature_invalid" };
  return { ok: true, requestHash: await sha256(`${request.operation}.${bodyHash}`) };
}

export async function signSystemRequest(operation: string, body: string, secret: string, timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID().replaceAll("-", "")) {
  const bodyHash = await sha256(body);
  return {
    "x-system-timestamp": timestamp,
    "x-system-nonce": nonce,
    "x-system-operation": operation,
    "x-system-signature": await hmac(secret, `${timestamp}.${nonce}.${operation}.${bodyHash}`),
  };
}
