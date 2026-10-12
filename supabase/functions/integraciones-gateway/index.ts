/**
 * Gateway de integraciones de Kawiil OS (middle) — Fase 2, SOLO LECTURA.
 *
 * El navegador nunca habla con MATI ni con Kit-to-Drive: llama a esta función
 * con su sesión de Kawiil. Aquí se decide todo:
 *   1. sesión válida y rol `transformador`
 *   2. límite de ritmo por usuario
 *   3. acción de una lista CERRADA (no es un proxy abierto) y parámetros validados
 *   4. llamada al puente con credencial de servicio propia (+ firma HMAC opcional)
 *   5. lista blanca de campos y enmascarado de datos personales
 *   6. bitácora append-only en `integration_audit` (sin cuerpos ni secretos)
 *
 * Secrets (Edge Functions):
 *   MATI_GATEWAY_URL       https://<ref>.supabase.co/functions/v1/mati-admin-bridge
 *   MATI_GATEWAY_TOKEN     credencial de servicio DEDICADA a Kawiil (≥ 32 caracteres).
 *                          Nunca el token de superadmin de MATI.
 *   MATI_GATEWAY_HMAC_KEY  opcional; si existe se firma cada petición (el puente
 *                          debe verificarla — ver docs/seguridad/informe-seguridad-mati.md, M7).
 * Sin URL y token la función responde «no configurado» y no llama a nadie.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  audit,
  authenticate,
  extractList,
  HttpError,
  isRateLimited,
  jsonResponse,
  pickFields,
  preflight,
  signRequestHeaders,
  type AuditOutcome,
  type FieldRule,
} from "../_shared/security.ts";

const SYSTEM = "mati";
const MAX_REQUESTS = 30;
const WINDOW_SECONDS = 60;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_ROWS = 200;

const ESTADOS_TICKET = ["abierto", "en_progreso", "resuelto", "cerrado"] as const;

type ActionDef = {
  path: string;
  /** Campos que pueden salir hacia el navegador. Lo demás se descarta. */
  fields?: Record<string, FieldRule>;
  list: boolean;
};

// Lista cerrada. Añadir una acción = añadirla aquí, con sus campos permitidos.
const ACTIONS: Record<string, ActionDef> = {
  status: {
    path: "/app/status",
    list: false,
    fields: { ok: "keep", status: "keep", version: "keep", environment: "keep", empresa_nombre: "keep" },
  },
  users: {
    path: "/users",
    list: true,
    fields: {
      id: "keep",
      nombre_completo: "keep",
      email: "email",
      area: "keep",
      nivel: "keep",
      activo: "keep",
      ultimo_acceso: "keep",
    },
  },
  modules: {
    path: "/modules",
    list: true,
    fields: { clave: "keep", nombre: "keep", descripcion: "keep", activo: "keep" },
  },
  tickets: {
    path: "/tickets",
    list: true,
    fields: {
      id: "keep",
      asunto: "keep",
      titulo: "keep",
      estado: "keep",
      prioridad: "keep",
      area: "keep",
      created_at: "keep",
      creado_en: "keep",
    },
  },
};

function bridgeConfig(): { url: string; token: string; hmacKey: string | null } | { problems: string[] } {
  const problems: string[] = [];
  const rawUrl = (Deno.env.get("MATI_GATEWAY_URL") ?? "").trim();
  const token = (Deno.env.get("MATI_GATEWAY_TOKEN") ?? "").trim();
  let url = "";
  if (!rawUrl) problems.push("MATI_GATEWAY_URL");
  else {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "https:" || u.username || u.password) problems.push("MATI_GATEWAY_URL (debe ser https sin credenciales)");
      else url = rawUrl.replace(/\/+$/, "");
    } catch {
      problems.push("MATI_GATEWAY_URL (no es una URL válida)");
    }
  }
  if (token.length < 32) problems.push("MATI_GATEWAY_TOKEN (≥ 32 caracteres)");
  if (problems.length) return { problems };
  return { url, token, hmacKey: (Deno.env.get("MATI_GATEWAY_HMAC_KEY") ?? "").trim() || null };
}

function parseParams(action: string, raw: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Parámetros inválidos", "bad_params");
  const p = raw as Record<string, unknown>;
  const allowed = action === "tickets" ? ["estado", "limit"] : [];
  for (const k of Object.keys(p)) {
    if (!allowed.includes(k)) throw new HttpError(400, "Parámetros inválidos", "bad_params");
  }
  if (action === "tickets") {
    if (p.estado !== undefined) {
      if (typeof p.estado !== "string" || !(ESTADOS_TICKET as readonly string[]).includes(p.estado)) {
        throw new HttpError(400, "Estado de ticket inválido", "bad_params");
      }
      out.estado = p.estado;
    }
    if (p.limit !== undefined) {
      const n = Number(p.limit);
      if (!Number.isInteger(n) || n < 1 || n > MAX_ROWS) throw new HttpError(400, "Límite inválido", "bad_params");
      out.limit = n;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight(req);
  if (req.method !== "POST") return jsonResponse(req, { error: "Método no permitido" }, 405);

  const started = Date.now();
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let caller: Awaited<ReturnType<typeof authenticate>> | null = null;
  let action = "unknown";
  let detail: Record<string, unknown> = {};

  const finish = async (outcome: AuditOutcome, status: number, body: unknown) => {
    // Sin usuario identificado no se escribe bitácora (evita llenar la tabla con tráfico anónimo).
    if (caller) {
      await audit(svc, {
        caller,
        system: SYSTEM,
        action,
        outcome,
        httpStatus: status,
        durationMs: Date.now() - started,
        detail,
      });
    }
    return jsonResponse(req, body, status);
  };

  try {
    caller = await authenticate(req, svc);

    if (!caller.isTransformador) {
      return await finish("denied", 403, { error: "No tienes permiso para esta acción", code: "forbidden" });
    }
    if (await isRateLimited(svc, caller.userId, SYSTEM, MAX_REQUESTS, WINDOW_SECONDS)) {
      return await finish("rate_limited", 429, { error: "Demasiadas solicitudes. Intenta en un minuto.", code: "rate_limited" });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || body.system !== SYSTEM || typeof body.action !== "string") {
      return await finish("denied", 400, { error: "Solicitud inválida", code: "bad_request" });
    }
    action = body.action;
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined;
    if (!def) {
      detail = { reason: "unknown_action" };
      action = "unknown";
      return await finish("denied", 400, { error: "Acción no permitida", code: "unknown_action" });
    }
    const params = parseParams(action, body.params);
    detail = { params };

    const cfg = bridgeConfig();
    if ("problems" in cfg) {
      detail = { ...detail, missing: cfg.problems };
      // `status` informa qué falta (solo nombres de variables); el resto responde 503.
      return await finish(
        "not_configured",
        action === "status" ? 200 : 503,
        { configured: false, problems: cfg.problems },
      );
    }

    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const qs = query.toString();
    const pathWithQuery = def.path + (qs ? `?${qs}` : "");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/json",
      "x-mati-actor": `kawiil:${caller.email ?? caller.userId}`.slice(0, 120),
    };
    if (cfg.hmacKey) Object.assign(headers, await signRequestHeaders(cfg.hmacKey, "GET", pathWithQuery));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(cfg.url + pathWithQuery, { method: "GET", headers, signal: ctrl.signal, redirect: "manual" });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "AbortError";
      detail = { ...detail, upstream: timedOut ? "timeout" : "unreachable" };
      return await finish("error", timedOut ? 504 : 502, {
        error: timedOut ? "El sistema externo tardó demasiado en responder" : "No se pudo contactar al sistema externo",
        code: "upstream_unreachable",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // El detalle del puente no se reenvía al navegador (puede traer información interna).
      detail = { ...detail, upstream_status: res.status };
      return await finish("error", 502, { error: "El sistema externo respondió con un error", code: "upstream_error" });
    }

    const payload: unknown = await res.json().catch(() => null);
    let data: unknown;
    if (def.list) {
      data = extractList(payload).slice(0, MAX_ROWS).map((r) => pickFields(r, def.fields!));
    } else {
      data = pickFields(payload, def.fields!);
    }
    detail = { ...detail, ...(Array.isArray(data) ? { count: data.length } : {}) };
    return await finish("ok", 200, {
      configured: true,
      data,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return await finish(e.status === 403 ? "denied" : "error", e.status, { error: e.message, code: e.code });
    }
    console.error("integraciones-gateway:", e instanceof Error ? e.message : "error desconocido");
    return await finish("error", 500, { error: "Error interno", code: "internal" });
  }
});
