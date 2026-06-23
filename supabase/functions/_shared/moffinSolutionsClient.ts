/**
 * Cliente HTTP Moffin Solutions API (consultas SAT: perfil, CSF, 32D, recuperación GET /query/{id}).
 * @see https://solutions-docs.moffin.mx/apis/consultas-al-sat
 */

export type MoffinSolutionsJson =
  | { ok: true; json: Record<string, unknown>; status: number }
  | { ok: false; message: string; status: number; bodySample?: string };

/**
 * Evita que la Edge se quede colgada si Moffin no responde (sync manual / refresh).
 * Default 60s: la opinión 32D (cadena Nubarium) tarda más que la CSF en devolver el
 * acuse en cola; con 25s el POST se abortaba ("Signal timed out") antes de obtener el
 * queryId y quedaba como error irrecuperable. Ajustable hasta 120s con
 * MOFFIN_SOLUTIONS_FETCH_TIMEOUT_MS.
 */
function moffinSolutionsFetchTimeoutMs(): number {
  const raw = Deno.env.get("MOFFIN_SOLUTIONS_FETCH_TIMEOUT_MS")?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 5_000 && n <= 120_000) return n;
  return 60_000;
}

export function moffinSolutionsFetchSignal(): AbortSignal {
  const ms = moffinSolutionsFetchTimeoutMs();
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Une campos habituales del JSON de error de Moffin (perfil SAT, query, etc.). */
function moffinSolutionsErrorMessage(
  json: Record<string, unknown>,
  httpStatus: number,
): string {
  const parts: string[] = [];
  const add = (s: string | undefined) => {
    const t = s?.trim();
    if (t) parts.push(t);
  };
  if (typeof json.message === "string") add(json.message);
  if (typeof json.error === "string") add(json.error);
  if (json.error && typeof json.error === "object" && !Array.isArray(json.error)) {
    const o = json.error as Record<string, unknown>;
    if (typeof o.message === "string") add(o.message);
  }
  if (typeof json.detail === "string") add(json.detail);
  if (typeof json.description === "string") add(json.description);
  const errs = json.errors;
  if (Array.isArray(errs)) {
    for (const e of errs) {
      if (typeof e === "string") add(e);
      else if (e && typeof e === "object" && "message" in (e as object)) {
        const m = (e as { message?: unknown }).message;
        if (typeof m === "string") add(m);
      }
    }
  }
  const out = Array.from(new Set(parts.filter(Boolean)));
  if (out.length) return out.join(" · ");
  return `HTTP ${httpStatus}`;
}

/**
 * Esquema de autorización para Solutions:
 * - "Bearer" (default): JWT obtenido vía OAuth /oauth/token o MOFFIN_SOLUTIONS_BEARER estático.
 * - "Token": API key tipo `Authorization: Token <key>` (mismo patrón que legacy; confirmado por Moffin
 *   para CSF cuando no se usa OAuth).
 */
export type MoffinSolutionsAuthScheme = "Bearer" | "Token";

function authHeaders(token: string, scheme: MoffinSolutionsAuthScheme): HeadersInit {
  return {
    Authorization: `${scheme} ${token.trim()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function moffinSolutionsPostJson(
  baseUrl: string,
  bearerToken: string,
  path: string,
  body: Record<string, unknown>,
  scheme: MoffinSolutionsAuthScheme = "Bearer",
): Promise<MoffinSolutionsJson> {
  const base = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${p}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(bearerToken, scheme),
      body: JSON.stringify(body),
      signal: moffinSolutionsFetchSignal(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort|timeout|timed\s*out/i.test(msg);
    return {
      ok: false,
      message: timedOut
        ? `Tiempo de espera agotado (${moffinSolutionsFetchTimeoutMs() / 1000}s) al llamar a Moffin Solutions. Reintenta o define MOFFIN_SOLUTIONS_FETCH_TIMEOUT_MS.`
        : msg,
      status: 0,
    };
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {
      ok: false,
      message: "Respuesta de Moffin no es JSON válido",
      status: res.status,
      bodySample: text.slice(0, 400),
    };
  }
  if (!res.ok) {
    const msg = moffinSolutionsErrorMessage(json, res.status);
    return { ok: false, message: msg, status: res.status, bodySample: text.slice(0, 200) };
  }
  return { ok: true, json, status: res.status };
}

export async function moffinSolutionsGetJson(
  baseUrl: string,
  bearerToken: string,
  queryId: string,
  scheme: MoffinSolutionsAuthScheme = "Bearer",
): Promise<MoffinSolutionsJson> {
  const base = baseUrl.replace(/\/$/, "");
  const id = encodeURIComponent(queryId.trim());
  const url = `${base}/query/${id}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `${scheme} ${bearerToken.trim()}`,
        Accept: "application/json",
      },
      signal: moffinSolutionsFetchSignal(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort|timeout|timed\s*out/i.test(msg);
    return {
      ok: false,
      message: timedOut
        ? `Tiempo de espera agotado (${moffinSolutionsFetchTimeoutMs() / 1000}s) al consultar estado en Moffin. Reintenta la sincronización.`
        : msg,
      status: 0,
    };
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {
      ok: false,
      message: "Respuesta de Moffin no es JSON válido",
      status: res.status,
      bodySample: text.slice(0, 400),
    };
  }
  if (!res.ok) {
    const msg = moffinSolutionsErrorMessage(json, res.status);
    return { ok: false, message: msg, status: res.status };
  }
  return { ok: true, json, status: res.status };
}

export function extractSolutionsQueryId(json: Record<string, unknown>): string | null {
  const coerce = (x: unknown): string | null => {
    if (typeof x === "string" && x.trim()) return x.trim();
    if (typeof x === "number" && Number.isFinite(x)) return String(x);
    return null;
  };
  const direct = coerce(json._id ?? json.id ?? json.queryId);
  if (direct) return direct;
  const data = json.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const inner = coerce(d._id ?? d.id ?? d.queryId);
    if (inner) return inner;
  }
  const query = json.query;
  if (query && typeof query === "object" && !Array.isArray(query)) {
    const q = query as Record<string, unknown>;
    const inner = coerce(q._id ?? q.id ?? q.queryId);
    if (inner) return inner;
  }
  return null;
}

export function extractMoffinProfileId(json: Record<string, unknown>): number | null {
  const p = json.profileId;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  if (typeof p === "string" && /^\d+$/.test(p.trim())) return parseInt(p.trim(), 10);
  return null;
}
