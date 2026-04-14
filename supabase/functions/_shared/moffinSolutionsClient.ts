/**
 * Cliente HTTP Moffin Solutions API (consultas SAT: perfil, CSF, 32D, recuperación GET /query/{id}).
 * @see https://solutions-docs.moffin.mx/apis/consultas-al-sat
 */

export type MoffinSolutionsJson =
  | { ok: true; json: Record<string, unknown>; status: number }
  | { ok: false; message: string; status: number; bodySample?: string };

function bearerHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token.trim()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function moffinSolutionsPostJson(
  baseUrl: string,
  bearerToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<MoffinSolutionsJson> {
  const base = baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${p}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: bearerHeaders(bearerToken),
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg, status: 0 };
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
    const msg =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `HTTP ${res.status}`;
    return { ok: false, message: msg, status: res.status, bodySample: text.slice(0, 200) };
  }
  return { ok: true, json, status: res.status };
}

export async function moffinSolutionsGetJson(
  baseUrl: string,
  bearerToken: string,
  queryId: string,
): Promise<MoffinSolutionsJson> {
  const base = baseUrl.replace(/\/$/, "");
  const id = encodeURIComponent(queryId.trim());
  const url = `${base}/query/${id}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken.trim()}`,
        Accept: "application/json",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg, status: 0 };
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
    const msg =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `HTTP ${res.status}`;
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
