/**
 * Utilidades HTTP de las Edge del portal (Deno). Sin lógica de negocio.
 * Dos clientes por petición:
 *   · `user`: con el JWT de quien llama → la RLS decide qué ve (aislamiento).
 *   · `admin`: service_role, solo para escribir lo que la RLS no permite al
 *     navegador (Storage, auth.admin, cifrados). NUNCA se usa para leer datos
 *     del cliente que luego se devuelvan sin haber pasado antes por `user`.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": Deno.env.get("PORTAL_ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface Ctx {
  req: Request;
  body: Record<string, unknown>;
  admin: SupabaseClient;
  anon: SupabaseClient;
  user: SupabaseClient | null;
  userId: string | null;
  email: string | null;
  isPortal: boolean;
  isStaff: boolean;
}

export async function buildCtx(req: Request): Promise<Ctx> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)/i)?.[1];
  const ctx: Ctx = { req, body, admin, anon, user: null, userId: null, email: null, isPortal: false, isStaff: false };
  if (!token || token === anonKey) return ctx;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return ctx;
  ctx.userId = data.user.id;
  ctx.email = data.user.email ?? null;
  ctx.user = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const [{ data: portal }, { data: staff }] = await Promise.all([
    admin.from("portal_accounts").select("user_id, status").eq("user_id", data.user.id).maybeSingle(),
    admin.rpc("portal_is_staff", { _uid: data.user.id }),
  ]);
  ctx.isPortal = !!portal;
  ctx.isStaff = staff === true;
  return ctx;
}

export function requireUser(ctx: Ctx): SupabaseClient {
  if (!ctx.user || !ctx.userId) throw new ApiError(401, "no_autorizado", "Inicie sesión.");
  return ctx.user;
}

export function str(v: unknown, field: string, max = 500): string {
  if (typeof v !== "string" || v.trim() === "") throw new ApiError(400, "dato_faltante", `Falta ${field}.`);
  if (v.length > max) throw new ApiError(400, "dato_invalido", `${field} es demasiado largo.`);
  return v.trim();
}

export function uuid(v: unknown, field: string): string {
  const s = str(v, field, 64);
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new ApiError(400, "dato_invalido", `${field} no es un identificador válido.`);
  return s;
}

/** ¿Quien llama puede actuar sobre el cliente? La base decide (RPC con el JWT del usuario). */
export async function assertClientAccess(ctx: Ctx, clientId: string, portalRoles: string[], staffOk = true) {
  const user = requireUser(ctx);
  if (ctx.isPortal) {
    const { data } = await user.rpc("portal_has_client_role", { _client_id: clientId, _roles: portalRoles });
    if (data === true) return;
  } else if (ctx.isStaff && staffOk) {
    const { data } = await user.rpc("portal_staff_in_client_org", { _uid: ctx.userId, _client_id: clientId });
    if (data === true) return;
  }
  throw new ApiError(403, "sin_permiso", "No tiene permiso sobre este cliente.");
}

export async function audit(ctx: Ctx, action: string, clientId: string | null, entityType: string | null, entityId: string | null, details: Record<string, unknown> = {}) {
  const { error } = await ctx.admin.rpc("portal_audit", {
    _action: action, _client_id: clientId, _entity_type: entityType, _entity_id: entityId, _details: details, _actor: ctx.userId,
  });
  if (error) throw new ApiError(500, "bitacora", `No se pudo registrar la bitácora: ${error.message}`);
}

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function cronAllowed(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return (!!secret && req.headers.get("x-cron-secret") === secret) ||
    (!!service && req.headers.get("Authorization") === `Bearer ${service}`);
}
