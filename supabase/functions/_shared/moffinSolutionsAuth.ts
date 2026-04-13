/**
 * Bearer para Moffin Solutions: OAuth client_credentials (recomendado) o secreto estático.
 * @see https://solutions-docs.moffin.mx/apis/authentication
 */
import { moffinSolutionsBearerToken } from "./moffinApiFlavor.ts";

export type ResolveMoffinSolutionsBearerResult =
  | { ok: true; bearer: string }
  | { ok: false; message: string };

type OauthCache = { accessToken: string; expiresAtSec: number };

let oauthCache: OauthCache | null = null;
const EXPIRY_BUFFER_SEC = 120;

function parseAccessToken(json: Record<string, unknown>): string {
  const a =
    (typeof json.accessToken === "string" && json.accessToken) ||
    (typeof json.access_token === "string" && json.access_token) ||
    "";
  return a.trim();
}

function parseExpiresAt(json: Record<string, unknown>, fallbackSec: number): number {
  const n =
    (typeof json.accessTokenExpiresAt === "number" && json.accessTokenExpiresAt) ||
    (typeof json.access_token_expires_at === "number" && json.access_token_expires_at) ||
    null;
  if (typeof n === "number" && Number.isFinite(n)) return Math.floor(n);
  return fallbackSec;
}

async function fetchOAuthAccessToken(baseUrl: string): Promise<ResolveMoffinSolutionsBearerResult> {
  const clientId = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID")?.trim() ?? "";
  const clientSecret = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET")?.trim() ?? "";
  if (!clientId || !clientSecret) {
    return { ok: false, message: "Faltan MOFFIN_SOLUTIONS_CLIENT_ID y/o MOFFIN_SOLUTIONS_CLIENT_SECRET" };
  }

  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/oauth/token`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grantType: "client_credentials",
        clientId,
        clientSecret,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `oauth/token red: ${msg}` };
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, message: `oauth/token no JSON: ${text.slice(0, 240)}` };
  }

  if (!res.ok) {
    const msg =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `HTTP ${res.status}`;
    oauthCache = null;
    return { ok: false, message: `oauth/token: ${msg}` };
  }

  const accessToken = parseAccessToken(json);
  if (!accessToken) {
    oauthCache = null;
    return { ok: false, message: "oauth/token: respuesta sin accessToken" };
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAtSec = parseExpiresAt(json, now + 3600);
  oauthCache = { accessToken, expiresAtSec };
  return { ok: true, bearer: accessToken };
}

/**
 * JWT de acceso para `Authorization: Bearer` en solutions-api.
 * Prioridad: OAuth con MOFFIN_SOLUTIONS_CLIENT_ID + SECRET; si no, MOFFIN_SOLUTIONS_BEARER / MOFFIN_API_KEY.
 */
export async function resolveMoffinSolutionsBearer(
  solutionsBaseUrl: string,
): Promise<ResolveMoffinSolutionsBearerResult> {
  const clientId = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID")?.trim() ?? "";
  const clientSecret = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET")?.trim() ?? "";

  if (clientId && clientSecret) {
    const now = Math.floor(Date.now() / 1000);
    if (oauthCache && oauthCache.expiresAtSec > now + EXPIRY_BUFFER_SEC) {
      return { ok: true, bearer: oauthCache.accessToken };
    }
    return await fetchOAuthAccessToken(solutionsBaseUrl);
  }

  const staticBearer = moffinSolutionsBearerToken();
  if (!staticBearer) {
    return {
      ok: false,
      message:
        "Solutions sin credencial: define MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET (OAuth, ver documentación Moffin Solutions) o MOFFIN_SOLUTIONS_BEARER con JWT devuelto por oauth/token — el token del panel «Configuración → API» de app.moffin no sustituye a clientId/clientSecret de Solutions.",
    };
  }
  return { ok: true, bearer: staticBearer };
}
