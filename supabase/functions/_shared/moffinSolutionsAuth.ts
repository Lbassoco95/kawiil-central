/**
 * Bearer para Moffin Solutions: OAuth client_credentials (recomendado) o secreto estático.
 * @see https://solutions-docs.moffin.mx/apis/authentication
 */
import { moffinSolutionsBearerToken } from "./moffinApiFlavor.ts";

export type ResolveMoffinSolutionsBearerResult =
  | { ok: true; bearer: string; via: "oauth" | "static" }
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

function oauthErrorMessage(status: number, json: Record<string, unknown>, text: string): string {
  const msg =
    (typeof json.message === "string" && json.message) ||
    (typeof json.error === "string" && json.error) ||
    (typeof json.error_description === "string" && json.error_description) ||
    `HTTP ${status}`;
  return msg;
}

async function tryOAuthTokenRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
  label: string,
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; status: number; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, message: `${label} red: ${msg}` };
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {
      ok: false,
      status: res.status,
      message: `${label} no JSON (${res.status}): ${text.slice(0, 200)}`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: `${label}: ${oauthErrorMessage(res.status, json, text)}`,
    };
  }
  const accessToken = parseAccessToken(json);
  if (!accessToken) {
    return { ok: false, status: res.status, message: `${label}: respuesta sin accessToken` };
  }
  return { ok: true, json };
}

async function fetchOAuthAccessToken(baseUrl: string): Promise<ResolveMoffinSolutionsBearerResult> {
  const clientId = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID")?.trim() ?? "";
  const clientSecret = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET")?.trim() ?? "";
  if (!clientId || !clientSecret) {
    return { ok: false, message: "Faltan MOFFIN_SOLUTIONS_CLIENT_ID y/o MOFFIN_SOLUTIONS_CLIENT_SECRET" };
  }

  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/oauth/token`;

  const formBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const attempts: { label: string; headers: Record<string, string>; body: string }[] = [
    {
      label: "oauth/form",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formBody.toString(),
    },
    {
      label: "oauth/json-camel",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grantType: "client_credentials",
        clientId,
        clientSecret,
      }),
    },
    {
      label: "oauth/json-snake",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
  ];

  const errors: string[] = [];
  for (const att of attempts) {
    const r = await tryOAuthTokenRequest(url, att.headers, att.body, att.label);
    if (r.ok) {
      const accessToken = parseAccessToken(r.json);
      const now = Math.floor(Date.now() / 1000);
      const expiresAtSec = parseExpiresAt(r.json, now + 3600);
      oauthCache = { accessToken, expiresAtSec };
      return { ok: true, bearer: accessToken, via: "oauth" };
    }
    errors.push(r.message);
    oauthCache = null;
    if (r.status >= 500) break;
  }

  return {
    ok: false,
    message: `oauth/token falló (${errors.join(" | ")}). Revisa clientId/clientSecret con Moffin (Solutions).`,
  };
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
      return { ok: true, bearer: oauthCache.accessToken, via: "oauth" };
    }
    return await fetchOAuthAccessToken(solutionsBaseUrl);
  }

  const staticBearer = moffinSolutionsBearerToken();
  if (!staticBearer) {
    return {
      ok: false,
      message:
        "Solutions sin credencial: define MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET (OAuth; Moffin Solutions) o MOFFIN_SOLUTIONS_BEARER con el JWT devuelto por POST /oauth/token. El token de «Configuración → API» de app.moffin no sirve como Bearer en solutions-api.",
    };
  }
  return { ok: true, bearer: staticBearer, via: "static" };
}
