/**
 * Utilidades de seguridad para Edge Functions de Kawiil (middle).
 *
 * - CORS con lista de orígenes (no `*`).
 * - Autenticación de usuario + rol (`transformador`).
 * - Límite de ritmo por usuario apoyado en `integration_audit`.
 * - Bitácora append-only.
 * - Firma HMAC-SHA256 de peticiones salientes.
 * - Enmascarado y lista blanca de campos.
 *
 * Nada de esto loguea tokens ni cuerpos de respuesta.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// ---------- CORS ----------
const DEFAULT_ORIGINS = [
  "https://www.kawiil-central.mx",
  "https://kawiil-central.mx",
  "https://kawiil-core-hub.lovable.app",
];

function allowedOrigins(): Set<string> {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

/** Cabeceras de respuesta. Si el origen no está permitido no se devuelve `Access-Control-Allow-Origin`. */
export function responseHeaders(req: Request, contentType = "application/json"): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const h: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  if (origin && allowedOrigins().has(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return h;
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(req) });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: responseHeaders(req) });
}

// ---------- Autenticación y rol ----------
export type Caller = { userId: string; email: string | null; orgId: string | null };
export type AuthedCaller = Caller & { isTransformador: boolean };

/** Sesión válida. Lanza HttpError 401 si no hay usuario; informa si es `transformador`. */
export async function authenticate(req: Request, svc: SupabaseClient): Promise<AuthedCaller> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Sesión requerida", "login_required");

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Sesión inválida", "login_required");

  const [{ data: role }, { data: prof }] = await Promise.all([
    svc.from("user_roles").select("role").eq("user_id", data.user.id).eq("role", "transformador").maybeSingle(),
    svc.from("profiles").select("organization_id").eq("user_id", data.user.id).maybeSingle(),
  ]);
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    orgId: (prof?.organization_id as string | undefined) ?? null,
    isTransformador: !!role,
  };
}

// ---------- Bitácora y ritmo ----------
export type AuditOutcome = "ok" | "denied" | "error" | "rate_limited" | "not_configured";

export type AuditEntry = {
  caller: Partial<Caller>;
  system: string;
  action: string;
  outcome: AuditOutcome;
  httpStatus?: number;
  durationMs?: number;
  /** Solo metadatos (parámetros validados, códigos). Nunca cuerpos, tokens ni contraseñas. */
  detail?: Record<string, unknown>;
};

export async function audit(svc: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await svc.from("integration_audit").insert({
    organization_id: e.caller.orgId ?? null,
    user_id: e.caller.userId ?? null,
    user_email: e.caller.email ?? null,
    system: e.system,
    action: e.action,
    outcome: e.outcome,
    http_status: e.httpStatus ?? null,
    duration_ms: e.durationMs ?? null,
    detail: e.detail ?? {},
  });
  // La bitácora no debe tumbar la petición, pero el fallo queda en logs.
  if (error) console.error("integration_audit insert:", error.message);
}

/** true si el usuario ya superó `max` intentos en los últimos `windowSec` segundos. */
export async function isRateLimited(
  svc: SupabaseClient,
  userId: string,
  system: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const { count, error } = await svc
    .from("integration_audit")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("system", system)
    .gte("created_at", since);
  if (error) {
    // Si no se puede contar, se falla cerrado: mejor frenar que dejar pasar sin límite.
    console.error("integration_audit count:", error.message);
    return true;
  }
  return (count ?? 0) >= max;
}

// ---------- HMAC ----------
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
}

/** Cabeceras de firma: HMAC-SHA256(key, `${ts}.${nonce}.${METHOD}.${path?query}`). */
export async function signRequestHeaders(
  key: string,
  method: string,
  pathWithQuery: string,
): Promise<Record<string, string>> {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const sig = await hmacSha256Hex(key, `${ts}.${nonce}.${method.toUpperCase()}.${pathWithQuery}`);
  return { "x-kawiil-timestamp": ts, "x-kawiil-nonce": nonce, "x-kawiil-signature": sig };
}

// ---------- Enmascarado y lista blanca ----------
export function maskEmail(v: unknown): string | null {
  if (typeof v !== "string" || !v.includes("@")) return null;
  const [local, domain] = v.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskTail(v: unknown, keep = 2): string | null {
  if (typeof v !== "string" || !v) return null;
  return v.length <= keep ? "*".repeat(v.length) : `${"*".repeat(v.length - keep)}${v.slice(-keep)}`;
}

export type FieldRule = "keep" | "email" | "tail";

/**
 * Devuelve solo los campos de `rules`; el resto se descarta. `email` y `tail`
 * enmascaran. Una clave ausente en `rules` NUNCA sale hacia el navegador.
 */
export function pickFields(row: unknown, rules: Record<string, FieldRule>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row || typeof row !== "object") return out;
  const src = row as Record<string, unknown>;
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in src)) continue;
    out[key] = rule === "email" ? maskEmail(src[key]) : rule === "tail" ? maskTail(src[key]) : src[key];
  }
  return out;
}

/** El puente puede devolver un arreglo o `{ data|users|modules|tickets: [...] }`. */
export function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const v of Object.values(payload as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
