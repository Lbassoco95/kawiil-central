/**
 * Cliente mínimo Standard Webhooks v1 para Gather Smart Objects (Deno Edge).
 * Equivalente al wire de @gathertown/webhook-object-sdk sin depender de Node.
 */

const MAX_BODY_BYTES = 4 * 1024;
const encoder = new TextEncoder();

function decodeWhsec(secret: string): Uint8Array {
  let s = secret.trim();
  if (s.startsWith("whsec_")) s = s.slice("whsec_".length);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
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

async function signBody(
  keyBytes: Uint8Array,
  msgId: string,
  timestampSeconds: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const toSign = encoder.encode(`${msgId}.${timestampSeconds}.${body}`);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, toSign));
  return `v1,${bytesToBase64(sig)}`;
}

export type GatherPingResult = {
  status: "pong";
  objectId: string;
  spaceId: string;
  preset: string | null;
  capabilities: Record<string, unknown>;
  colors?: string[];
};

export type GatherSendResult = {
  status: "dispatched" | "space_idle";
  [key: string]: unknown;
};

function assertHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid_url");
  }
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && local.has(parsed.hostname)) return;
  throw new Error("invalid_url");
}

async function deliver(
  url: string,
  secret: string,
  type: string,
  data: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  assertHttpsUrl(url);
  const body = JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    data,
  });
  if (encoder.encode(body).length > MAX_BODY_BYTES) {
    throw new Error("payload_too_large");
  }

  const keyBytes = decodeWhsec(secret);
  const webhookId = crypto.randomUUID();
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ts = Math.floor(Date.now() / 1000);
    const signature = await signBody(keyBytes, webhookId, ts, body);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "webhook-id": webhookId,
          "webhook-timestamp": String(ts),
          "webhook-signature": signature,
        },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`gather_http_${res.status}`);
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
        throw new Error(code);
      }
      return json;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < 2 && /gather_http_|network|fetch/i.test(lastErr.message)) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error("gather_deliver_failed");
}

export async function gatherPing(url: string, secret: string): Promise<GatherPingResult> {
  const body = await deliver(url, secret, "webhook.ping", {});
  if (body.status !== "pong") throw new Error("unexpected_ping_response");
  return body as GatherPingResult;
}

export async function gatherSend(
  url: string,
  secret: string,
  type: string,
  data: Record<string, unknown> = {},
): Promise<GatherSendResult> {
  const body = await deliver(url, secret, type, data);
  if (body.status !== "dispatched" && body.status !== "space_idle") {
    throw new Error("unexpected_send_response");
  }
  return body as GatherSendResult;
}
