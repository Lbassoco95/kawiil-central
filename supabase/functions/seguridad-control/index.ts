/**
 * Plano de control de SOLO LECTURA — MATI Admin (vía MATI API) consulta el estado de seguridad de Kawiil.
 *
 * Servidor a servidor: no es para navegadores (no responde CORS; OPTIONS → 405). Lo llama MATI API con
 *   · credencial propia (`Authorization: Bearer <SEGURIDAD_CONTROL_TOKEN>`), y
 *   · firma HMAC de cada petición con hora y nonce de un solo uso (ver _shared/controlAuth.ts).
 *
 * Una sola ruta, `POST`, con `{ "action": "...", "params": {...} }` y una lista CERRADA de acciones, todas de lectura:
 *   status     versión del contrato y acciones disponibles
 *   snapshot   todo junto: protecciones, resumen de usuarios, actividad (24 h), secretos y hallazgos
 *   posture    protecciones de la base (RLS, políticas abiertas, privilegios de anon, funciones expuestas…)
 *   users      usuarios con correo ENMASCARADO, roles, último acceso, MFA y bloqueo   (params.limit ≤ 1000)
 *   activity   eventos de autenticación por acción, sin IPs ni usuarios               (params.hours ≤ 168)
 *   secrets    qué secretos de seguridad están configurados (solo sí/no, nunca valores)
 *   audit      lo que MATI consultó, de la bitácora append-only                       (params.limit ≤ 100)
 *
 * Cada consulta autenticada queda en `integration_audit` (system = "mati-control") con el actor que
 * mandó MATI en `x-mati-actor` (siempre con prefijo `mati:`), sin datos de la respuesta.
 *
 * Secretos (Edge Functions): SEGURIDAD_CONTROL_TOKEN y SEGURIDAD_CONTROL_HMAC_KEY (≥ 32 caracteres, distintos),
 * y opcionalmente *_PREVIOUS de cada uno para rotar sin cortar el servicio. Sin ellos responde 503.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { audit, HttpError, jsonResponse, type AuditOutcome } from "../_shared/security.ts";
import { bindActor, loadControlConfig, tokenOk, verifyControlSignature } from "../_shared/controlAuth.ts";
import { deriveFindings, summarizeUsers, type SecretStatus } from "../_shared/controlFindings.ts";

const SYSTEM = "mati-control";
const CONTRACT_VERSION = "1";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_REQUESTS = 60;
const WINDOW_SECONDS = 60;
const ACTIONS = ["status", "snapshot", "posture", "users", "activity", "secrets", "audit"] as const;
type Action = (typeof ACTIONS)[number];

/** Secretos que importan para la seguridad. Solo se informa si existen y si tienen largo suficiente. */
const SECRET_CHECKS: Array<{ name: string; min: number; required: boolean; purpose: string }> = [
  { name: "CRON_SECRET", min: 32, required: true, purpose: "Autentica los trabajos programados (por ejemplo travel-refresh)" },
  { name: "MTG_GRAPH_CLIENT_STATE", min: 16, required: false, purpose: "Valida las notificaciones de Microsoft Graph del webhook de juntas" },
  { name: "OAUTH_STATE_SECRET", min: 32, required: false, purpose: "Firma el state de OAuth (si falta se deriva de la clave de servicio)" },
  { name: "ALLOWED_ORIGINS", min: 1, required: false, purpose: "Orígenes extra permitidos por CORS (los de producción ya van por defecto)" },
];

function secretsStatus(): SecretStatus[] {
  return SECRET_CHECKS.map((s) => {
    const v = (Deno.env.get(s.name) ?? "").trim();
    return { name: s.name, required: s.required, set: v.length > 0, length_ok: v.length >= s.min, purpose: s.purpose };
  });
}

function intParam(raw: unknown, name: string, min: number, max: number, dflt: number): number {
  if (raw === undefined) return dflt;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new HttpError(400, `${name} inválido (entero entre ${min} y ${max})`, "bad_params");
  }
  return raw;
}

/** Cada acción acepta solo sus parámetros; cualquier otra clave se rechaza. */
function checkParams(action: Action, raw: unknown): Record<string, number> {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Parámetros inválidos", "bad_params");
  const p = raw as Record<string, unknown>;
  const allowed = action === "users" ? ["limit"] : action === "audit" ? ["limit"] : action === "activity" ? ["hours"] : [];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) throw new HttpError(400, "Parámetros inválidos", "bad_params");
  if (action === "users") return { limit: intParam(p.limit, "limit", 1, 1000, 500) };
  if (action === "audit") return { limit: intParam(p.limit, "limit", 1, 100, 50) };
  if (action === "activity") return { hours: intParam(p.hours, "hours", 1, 168, 24) };
  return {};
}

async function rpc(svc: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await svc.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** Límite de ritmo del cliente MATI contando sus filas de bitácora. Si no puede contar, frena (falla cerrado). */
async function isRateLimited(svc: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();
  const { count, error } = await svc
    .from("integration_audit")
    .select("id", { count: "exact", head: true })
    .eq("system", SYSTEM)
    .gte("created_at", since);
  if (error) {
    console.error("seguridad-control rate limit:", error.message);
    return true;
  }
  return (count ?? 0) >= MAX_REQUESTS;
}

/** Nonce de un solo uso: el índice único decide quién llegó primero. Si el almacén falla, se rechaza. */
async function consumeNonce(svc: SupabaseClient, nonce: string): Promise<boolean> {
  const { error } = await svc.from("control_nonces").insert({ nonce, client_id: "mati" });
  if (!error) {
    if (Math.random() < 0.02) await svc.from("control_nonces").delete().lt("at", new Date(Date.now() - 3600_000).toISOString());
    return true;
  }
  if ((error as { code?: string }).code === "23505") return false;
  throw new Error(`control_nonces: ${error.message}`);
}

async function run(svc: SupabaseClient, action: Action, p: Record<string, number>): Promise<unknown> {
  const generated_at = new Date().toISOString();
  switch (action) {
    case "status":
      return { contract: CONTRACT_VERSION, read_only: true, actions: ACTIONS, generated_at };
    case "posture":
      return await rpc(svc, "security_posture");
    case "users":
      return { users: await rpc(svc, "security_users_snapshot", { p_limit: p.limit }) };
    case "activity":
      return await rpc(svc, "security_auth_activity", { p_hours: p.hours });
    case "secrets":
      return { secrets: secretsStatus() };
    case "audit": {
      const { data, error } = await svc
        .from("integration_audit")
        .select("created_at, action, outcome, http_status, user_email, detail")
        .eq("system", SYSTEM)
        .order("created_at", { ascending: false })
        .limit(p.limit);
      if (error) throw new Error(`audit: ${error.message}`);
      return { entries: data ?? [] };
    }
    case "snapshot": {
      const [posture, usersList, activity] = await Promise.all([
        rpc(svc, "security_posture"),
        rpc(svc, "security_users_snapshot", { p_limit: 1000 }),
        rpc(svc, "security_auth_activity", { p_hours: 24 }),
      ]);
      const secrets = secretsStatus();
      const users = summarizeUsers(usersList);
      return {
        contract: CONTRACT_VERSION,
        generated_at,
        posture,
        users,
        activity,
        secrets,
        findings: deriveFindings((posture ?? {}) as Parameters<typeof deriveFindings>[0], secrets, users),
      };
    }
  }
}

Deno.serve(async (req) => {
  // Servidor a servidor: sin CORS. Un navegador no debería poder llamar esto.
  if (req.method === "OPTIONS") return new Response(null, { status: 405 });
  if (req.method !== "POST") return jsonResponse(req, { error: "Método no permitido" }, 405);

  const started = Date.now();
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Solo hay bitácora una vez que la credencial es válida (el tráfico anónimo no llena la tabla).
  let authenticated = false;
  let actor: string | null = null;
  let action = "unknown";
  let detail: Record<string, unknown> = {};
  const finish = async (outcome: AuditOutcome, status: number, body: unknown) => {
    if (authenticated) {
      await audit(svc, { caller: { email: actor }, system: SYSTEM, action, outcome, httpStatus: status, durationMs: Date.now() - started, detail });
    }
    return jsonResponse(req, body, status);
  };

  try {
    const cfg = loadControlConfig((n) => Deno.env.get(n));
    if (cfg.problems.length) {
      // No se dice qué falta a quien no se ha identificado; el detalle queda en los registros.
      console.error("seguridad-control no configurado:", cfg.problems.join("; "));
      return jsonResponse(req, { error: "Plano de control no configurado", code: "not_configured" }, 503);
    }
    if (!(await tokenOk(req, cfg.tokens))) {
      console.warn("seguridad-control: credencial inválida");
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }
    authenticated = true;
    actor = bindActor(req.headers.get("x-mati-actor"));

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_BYTES) return await finish("denied", 413, { error: "Cuerpo demasiado grande", code: "too_large" });

    const sig = await verifyControlSignature({
      method: req.method,
      bodyText,
      headers: req.headers,
      keys: cfg.hmacKeys,
      nowSec: Math.floor(Date.now() / 1000),
      consumeNonce: (n) => consumeNonce(svc, n),
    });
    if (!sig.ok) {
      detail = { reason: `signature_${sig.reason}` };
      console.warn("seguridad-control: firma rechazada", sig.reason);
      return await finish("denied", 401, { error: "Unauthorized", code: "signature_invalid" });
    }

    let body: { action?: unknown; params?: unknown } | null = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return await finish("denied", 400, { error: "Solicitud inválida", code: "bad_request" });
    }
    if (!(ACTIONS as readonly string[]).includes(body.action)) {
      detail = { reason: "unknown_action" };
      return await finish("denied", 400, { error: "Acción no permitida", code: "unknown_action" });
    }
    action = body.action;

    if (await isRateLimited(svc)) {
      return await finish("rate_limited", 429, { error: "Demasiadas solicitudes. Intenta en un minuto.", code: "rate_limited" });
    }

    const params = checkParams(action as Action, body.params);
    detail = { params };
    const data = await run(svc, action as Action, params);
    return await finish("ok", 200, { contract: CONTRACT_VERSION, action, data });
  } catch (e) {
    if (e instanceof HttpError) return await finish("denied", e.status, { error: e.message, code: e.code });
    console.error("seguridad-control:", e instanceof Error ? e.message : "error desconocido");
    return await finish("error", 500, { error: "Error interno", code: "internal" });
  }
});
