/**
 * Bearer para Moffin Solutions: OAuth client_credentials (recomendado) o secreto estático.
 * @see https://solutions-docs.moffin.mx/apis/authentication
 */
import { moffinSolutionsBearerToken } from "./moffinApiFlavor.ts";
import {
  moffinSolutionsFetchSignal,
  type MoffinSolutionsAuthScheme,
} from "./moffinSolutionsClient.ts";

export type SolutionsStaticBearerSource =
  | "solutions_bearer_env"
  | "api_key_env"
  | "solutions_api_key_env";

export type ResolveMoffinSolutionsBearerResult =
  | { ok: true; bearer: string; scheme: MoffinSolutionsAuthScheme; via: "oauth" }
  | {
      ok: true;
      bearer: string;
      scheme: MoffinSolutionsAuthScheme;
      via: "static";
      staticSource: SolutionsStaticBearerSource;
    }
  | { ok: false; message: string; code?: "oauth_incomplete" };

/**
 * Esquema de auth forzado por env. `token` usa `Authorization: Token <key>` (confirmado por Moffin
 * para CSF/32D cuando no se usa OAuth). Default/empty/`bearer` mantiene JWT Bearer.
 */
function getConfiguredAuthScheme(): MoffinSolutionsAuthScheme | null {
  const raw = Deno.env.get("MOFFIN_SOLUTIONS_AUTH_SCHEME")?.trim().toLowerCase() ?? "";
  if (!raw) return null;
  if (raw === "token") return "Token";
  if (raw === "bearer") return "Bearer";
  return null;
}

function normalizeKey(value: string): string {
  let v = value.trim().replace(/\r?\n/g, "").replace(/\s+/g, " ");
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, "").trim();
  if (/^token\s+/i.test(v)) v = v.replace(/^token\s+/i, "").trim();
  return v;
}

/**
 * Resolución para scheme=Token: usa MOFFIN_SOLUTIONS_API_KEY (preferido), o cae en
 * MOFFIN_SOLUTIONS_BEARER / MOFFIN_API_KEY. No valida forma JWT porque es una API key legacy.
 */
function resolveTokenSchemeKey(): { key: string; source: SolutionsStaticBearerSource } | null {
  const solApi = normalizeKey(Deno.env.get("MOFFIN_SOLUTIONS_API_KEY")?.trim() ?? "");
  if (solApi) return { key: solApi, source: "solutions_api_key_env" };
  const solBearer = normalizeKey(Deno.env.get("MOFFIN_SOLUTIONS_BEARER")?.trim() ?? "");
  if (solBearer) return { key: solBearer, source: "solutions_bearer_env" };
  const apiKey = normalizeKey(Deno.env.get("MOFFIN_API_KEY")?.trim() ?? "");
  if (apiKey) return { key: apiKey, source: "api_key_env" };
  return null;
}

/**
 * El accessToken de POST …/oauth/token (Solutions) suele ser JWT (tres segmentos base64url).
 * El token de «Configuración → API» de app.moffin no cumple esto y provoca 401 en profile/CSF.
 */
export function looksLikeOauthAccessJwt(token: string): boolean {
  const t = token.trim().replace(/^bearer\s+/i, "").trim();
  if (t.length < 30) return false;
  const parts = t.split(".");
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length >= 4 && !/\s/.test(p));
}

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
    res = await fetch(url, { method: "POST", headers, body, signal: moffinSolutionsFetchSignal() });
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

/** URLs candidatas POST oauth/token (algunos despliegues usan /api/oauth/token u host sin /api). */
function buildOauthTokenPostUrls(solutionsBaseUrl: string): string[] {
  const explicit = Deno.env.get("MOFFIN_SOLUTIONS_OAUTH_TOKEN_URL")?.trim();
  if (explicit) {
    return [explicit.replace(/\/$/, "")];
  }
  const base = solutionsBaseUrl.replace(/\/$/, "");
  const urls: string[] = [];
  const add = (u: string) => {
    const t = u.replace(/\/$/, "");
    if (!urls.includes(t)) urls.push(t);
  };
  if (/\/api$/i.test(base)) {
    add(`${base.replace(/\/api$/i, "")}/oauth/token`);
    add(`${base}/oauth/token`);
  } else {
    add(`${base}/oauth/token`);
    add(`${base}/api/oauth/token`);
  }
  return urls;
}

async function fetchOAuthAccessToken(baseUrl: string): Promise<ResolveMoffinSolutionsBearerResult> {
  const clientId = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID")?.trim() ?? "";
  const clientSecret = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET")?.trim() ?? "";
  if (!clientId || !clientSecret) {
    return { ok: false, message: "Faltan MOFFIN_SOLUTIONS_CLIENT_ID y/o MOFFIN_SOLUTIONS_CLIENT_SECRET" };
  }

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

  const postUrls = buildOauthTokenPostUrls(baseUrl);
  const errors: string[] = [];
  for (const url of postUrls) {
    for (const att of attempts) {
      const r = await tryOAuthTokenRequest(url, att.headers, att.body, att.label);
      if (r.ok) {
        const accessToken = parseAccessToken(r.json);
        const now = Math.floor(Date.now() / 1000);
        const expiresAtSec = parseExpiresAt(r.json, now + 3600);
        oauthCache = { accessToken, expiresAtSec };
        return { ok: true, bearer: accessToken, scheme: "Bearer", via: "oauth" };
      }
      errors.push(`${url} · ${att.label}: ${r.message}`);
      oauthCache = null;
    }
  }

  return {
    ok: false,
    message:
      `oauth/token falló (${errors.join(" | ")}). Revisa clientId/clientSecret y MOFFIN_SOLUTIONS_BASE_URL. ` +
      `Si Moffin documenta otra URL para OAuth, define MOFFIN_SOLUTIONS_OAUTH_TOKEN_URL (POST completo, sin barra final).`,
  };
}

/**
 * Credencial para `Authorization: <scheme> <token>` en solutions-api.
 * Prioridad:
 *   1. `MOFFIN_SOLUTIONS_AUTH_SCHEME=token` → API key con scheme "Token" (sin validación JWT).
 *      Fuente: MOFFIN_SOLUTIONS_API_KEY → MOFFIN_SOLUTIONS_BEARER → MOFFIN_API_KEY.
 *   2. OAuth con MOFFIN_SOLUTIONS_CLIENT_ID + SECRET → JWT Bearer.
 *   3. MOFFIN_SOLUTIONS_BEARER estático (o MOFFIN_API_KEY con forma JWT) → Bearer.
 */
export async function resolveMoffinSolutionsBearer(
  solutionsBaseUrl: string,
): Promise<ResolveMoffinSolutionsBearerResult> {
  const forcedScheme = getConfiguredAuthScheme();

  if (forcedScheme === "Token") {
    const resolved = resolveTokenSchemeKey();
    if (!resolved) {
      return {
        ok: false,
        message:
          "MOFFIN_SOLUTIONS_AUTH_SCHEME=token requiere una API key: define MOFFIN_SOLUTIONS_API_KEY (recomendado), o reutiliza MOFFIN_SOLUTIONS_BEARER / MOFFIN_API_KEY.",
      };
    }
    return {
      ok: true,
      bearer: resolved.key,
      scheme: "Token",
      via: "static",
      staticSource: resolved.source,
    };
  }

  const clientId = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID")?.trim() ?? "";
  const clientSecret = Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET")?.trim() ?? "";

  if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
    return {
      ok: false,
      code: "oauth_incomplete",
      message:
        "OAuth Solutions incompleto: MOFFIN_SOLUTIONS_CLIENT_ID y MOFFIN_SOLUTIONS_CLIENT_SECRET deben tener valor no vacío en Supabase. Si uno quedó vacío o mal pegado, Kawiil no usa /oauth/token y cae en Bearer estático (MOFFIN_SOLUTIONS_BEARER / MOFFIN_API_KEY), con 401 en perfil SAT.",
    };
  }

  if (clientId && clientSecret) {
    const now = Math.floor(Date.now() / 1000);
    if (oauthCache && oauthCache.expiresAtSec > now + EXPIRY_BUFFER_SEC) {
      return { ok: true, bearer: oauthCache.accessToken, scheme: "Bearer", via: "oauth" };
    }
    return await fetchOAuthAccessToken(solutionsBaseUrl);
  }

  const staticBearer = moffinSolutionsBearerToken();
  if (!staticBearer) {
    return {
      ok: false,
      message:
        "Solutions sin credencial: define MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET (OAuth; Moffin Solutions), MOFFIN_SOLUTIONS_BEARER con el JWT devuelto por POST /oauth/token, o MOFFIN_SOLUTIONS_AUTH_SCHEME=token + MOFFIN_SOLUTIONS_API_KEY (esquema API key legacy).",
    };
  }
  // Solo validar forma JWT cuando el Bearer sale de MOFFIN_API_KEY (suele ser token legacy corto).
  // Si MOFFIN_SOLUTIONS_BEARER está definido, no exigir tres segmentos: algunos entornos usan token opaco.
  const usedExplicitSolutionsBearer = (Deno.env.get("MOFFIN_SOLUTIONS_BEARER") ?? "").trim().length > 0;
  if (!usedExplicitSolutionsBearer && !looksLikeOauthAccessJwt(staticBearer)) {
    return {
      ok: false,
      message:
        "MOFFIN_API_KEY es la clave legacy de app.moffin (lista 69-B); no sirve como Bearer en solutions-api. En Supabase → Edge Functions → Secrets añade MOFFIN_SOLUTIONS_CLIENT_ID y MOFFIN_SOLUTIONS_CLIENT_SECRET (OAuth), o define MOFFIN_SOLUTIONS_AUTH_SCHEME=token + MOFFIN_SOLUTIONS_API_KEY para el esquema Token (API key legacy en Solutions), o MOFFIN_SOLUTIONS_BEARER con el accessToken que devuelve POST …/oauth/token.",
    };
  }
  const staticSource: SolutionsStaticBearerSource = usedExplicitSolutionsBearer
    ? "solutions_bearer_env"
    : "api_key_env";
  return { ok: true, bearer: staticBearer, scheme: "Bearer", via: "static", staticSource };
}
