/**
 * Auth SATgo (https://api.sat-go.com).
 *
 * Preferencia de secretos (Edge):
 * 1) SATGO_API_KEY — key de POST /api/v1/Users/Createkey; se canjea por JWT vía
 *    POST /api/Auth/token-json (o /api/Auth/token?key=…).
 * 2) SATGO_ACCESS_TOKEN — JWT listo (Clerk portal o access.value del canje). Útil para
 *    pruebas; caduca (~1 día el de API; el de Clerk suele durar más).
 *
 * Docs: https://sat-go.com/docs · https://api.sat-go.com/scalar/v2
 */

export type SatgoAuthOk = {
  ok: true;
  bearer: string;
  via: "api_key" | "access_token";
};

export type SatgoAuthErr = {
  ok: false;
  message: string;
  code: "satgo_not_configured" | "satgo_token_exchange_failed";
};

let cachedBearer: { token: string; expMs: number } | null = null;

export function satgoBaseUrl(): string {
  return (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(/\/$/, "");
}

export function isSatgoConfigured(): boolean {
  return (
    !!(Deno.env.get("SATGO_API_KEY")?.trim() || Deno.env.get("SATGO_ACCESS_TOKEN")?.trim())
  );
}

/** Si true (default cuando hay secretos SATgo), CSF/32D van por SATgo en lugar de Moffin Solutions. */
export function useSatgoForCsf32d(): boolean {
  const forced = (Deno.env.get("SAT_CSF_PROVIDER") ?? "").trim().toLowerCase();
  if (forced === "satgo") return isSatgoConfigured();
  if (forced === "moffin") return false;
  return isSatgoConfigured();
}

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad);
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pickAccessTokenFromExchange(json: Record<string, unknown>): string | null {
  const nested = json.tokens;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const access = (nested as Record<string, unknown>).access;
    if (access && typeof access === "object" && !Array.isArray(access)) {
      const v = (access as Record<string, unknown>).value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (typeof json.token === "string" && json.token.trim()) return json.token.trim();
  if (typeof json.accessToken === "string" && json.accessToken.trim()) {
    return json.accessToken.trim();
  }
  return null;
}

async function exchangeApiKey(base: string, apiKey: string): Promise<SatgoAuthOk | SatgoAuthErr> {
  const url = `${base}/api/Auth/token-json`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key: apiKey }),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    if (!res.ok) {
      return {
        ok: false,
        code: "satgo_token_exchange_failed",
        message: `SATgo /Auth/token-json HTTP ${res.status}: ${
          typeof json.message === "string" ? json.message : text.slice(0, 200)
        }`,
      };
    }
    const bearer = pickAccessTokenFromExchange(json);
    if (!bearer) {
      return {
        ok: false,
        code: "satgo_token_exchange_failed",
        message: "SATgo no devolvió access token en /Auth/token-json.",
      };
    }
    const expMs = decodeJwtExpMs(bearer) ?? Date.now() + 50 * 60 * 1000;
    cachedBearer = { token: bearer, expMs };
    return { ok: true, bearer, via: "api_key" };
  } catch (e) {
    return {
      ok: false,
      code: "satgo_token_exchange_failed",
      message: `SATgo token exchange: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function resolveSatgoBearer(): Promise<SatgoAuthOk | SatgoAuthErr> {
  const apiKey = Deno.env.get("SATGO_API_KEY")?.trim() ?? "";
  const access = Deno.env.get("SATGO_ACCESS_TOKEN")?.trim() ?? "";
  const base = satgoBaseUrl();

  if (apiKey) {
    if (cachedBearer && cachedBearer.expMs > Date.now() + 60_000) {
      return { ok: true, bearer: cachedBearer.token, via: "api_key" };
    }
    return exchangeApiKey(base, apiKey);
  }

  if (access) {
    return { ok: true, bearer: access, via: "access_token" };
  }

  return {
    ok: false,
    code: "satgo_not_configured",
    message:
      "Configura SATGO_API_KEY (recomendado; Createkey + /Auth/token-json) o SATGO_ACCESS_TOKEN en Edge Functions → Secrets.",
  };
}
