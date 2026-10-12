/**
 * Gateway de integraciones de Kawiil OS (middle) — Fase 2 (lectura) y Fase 3 (escritura controlada).
 *
 * El navegador nunca habla con MATI ni con Kit-to-Drive: llama a esta función
 * con su sesión de Kawiil. Aquí se decide todo:
 *   1. sesión válida y rol `transformador`
 *   2. límite de ritmo por usuario (más estricto para escrituras)
 *   3. acción de una lista CERRADA (no es un proxy abierto) y parámetros validados
 *   4. llamada al puente con credencial de servicio propia (+ firma HMAC)
 *   5. lista blanca de campos y enmascarado de datos personales
 *   6. bitácora append-only en `integration_audit` (sin cuerpos ni secretos)
 *
 * Escrituras (Fase 3, primera ola): `ticket_update` (estado y prioridad) y
 * `ticket_message` (responder un ticket). Quedan APAGADAS salvo que se active
 * `MATI_GATEWAY_WRITES=on`, y entonces exigen además `MATI_GATEWAY_HMAC_KEY`.
 * No se activan hasta que MATI acepte una credencial dedicada a Kawiil y verifique
 * la firma (ver docs/seguridad/plan-seguridad-kawiil-os.md, 5.11). Cada escritura
 * lleva doble registro: la bitácora de Kawiil y el actor (`x-mati-actor`) en la del puente.
 *
 * Secrets (Edge Functions):
 *   MATI_GATEWAY_URL       https://<ref>.supabase.co/functions/v1/mati-admin-bridge
 *   MATI_GATEWAY_TOKEN     credencial de servicio DEDICADA a Kawiil (≥ 32 caracteres).
 *                          Nunca el token de superadmin de MATI.
 *   MATI_GATEWAY_HMAC_KEY  firma cada petición (lecturas: opcional; escrituras: obligatoria).
 *                          El puente debe verificarla — ver docs/seguridad/informe-seguridad-mati.md, M7.
 *   MATI_GATEWAY_WRITES    `on` para permitir escrituras. Cualquier otro valor = apagadas.
 * Sin URL y token la función responde «no configurado» y no llama a nadie.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  audit,
  authenticate,
  extractList,
  hasRecentDuplicate,
  HttpError,
  isRateLimited,
  jsonResponse,
  pickFields,
  preflight,
  sha256HexOf,
  signRequestHeaders,
  type AuditOutcome,
  type FieldRule,
} from "../_shared/security.ts";

const SYSTEM = "mati";
const MAX_REQUESTS = 30;
const WINDOW_SECONDS = 60;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_ROWS = 200;
// Escrituras: más estrictas que las lecturas.
const MAX_WRITES = 10;
const DUPLICATE_WINDOW_SECONDS = 60;
const MAX_MESSAGE_CHARS = 5000;
const ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ESTADOS_TICKET = ["abierto", "en_progreso", "resuelto", "cerrado"] as const;
const PRIORIDADES_TICKET = ["baja", "media", "alta", "urgente"] as const;

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

type BridgeConfig = { url: string; token: string; hmacKey: string | null };

type WriteDef = {
  method: "PATCH" | "POST";
  /** Campos del resultado que pueden volver al navegador. */
  fields: Record<string, FieldRule>;
};

// Lista cerrada de escrituras (primera ola de la Fase 3). Añadir una = añadirla aquí,
// con su validación en `parseWriteParams` y su prueba.
const WRITES: Record<string, WriteDef> = {
  ticket_update: {
    method: "PATCH",
    fields: { id: "keep", asunto: "keep", titulo: "keep", estado: "keep", prioridad: "keep", area: "keep" },
  },
  ticket_message: {
    method: "POST",
    fields: { id: "keep", created_at: "keep", creado_en: "keep" },
  },
};

type WriteRequest = {
  path: string;
  /** Lo que se envía al puente. */
  bridgeBody: Record<string, unknown>;
  /** Lo que se guarda en la bitácora: ids y valores de lista cerrada, nunca texto libre. */
  audit: Record<string, unknown>;
  /** Valor con el que se detectan duplicados (solo acciones que lo necesitan). */
  dedupeValue?: string;
};

function badWriteParams(): never {
  throw new HttpError(400, "Parámetros inválidos", "bad_params");
}

async function parseWriteParams(action: string, raw: unknown): Promise<WriteRequest> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) badWriteParams();
  const p = raw as Record<string, unknown>;
  const allowed = action === "ticket_update" ? ["id", "estado", "prioridad"] : ["id", "mensaje"];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) badWriteParams();
  if (typeof p.id !== "string" || !ID_REGEX.test(p.id)) throw new HttpError(400, "Id de ticket inválido", "bad_params");
  const id = p.id.toLowerCase();
  const path = `/tickets/${id}`;

  if (action === "ticket_update") {
    const body: Record<string, unknown> = {};
    if (p.estado !== undefined) {
      if (typeof p.estado !== "string" || !(ESTADOS_TICKET as readonly string[]).includes(p.estado)) {
        throw new HttpError(400, "Estado de ticket inválido", "bad_params");
      }
      body.estado = p.estado;
    }
    if (p.prioridad !== undefined) {
      if (typeof p.prioridad !== "string" || !(PRIORIDADES_TICKET as readonly string[]).includes(p.prioridad)) {
        throw new HttpError(400, "Prioridad de ticket inválida", "bad_params");
      }
      body.prioridad = p.prioridad;
    }
    if (!Object.keys(body).length) throw new HttpError(400, "Indica el estado o la prioridad", "bad_params");
    return { path, bridgeBody: body, audit: { params: { id, ...body } } };
  }

  // ticket_message
  if (typeof p.mensaje !== "string") throw new HttpError(400, "Mensaje inválido", "bad_params");
  const mensaje = p.mensaje.trim();
  if (!mensaje || mensaje.length > MAX_MESSAGE_CHARS || mensaje.includes("\u0000")) {
    throw new HttpError(400, `El mensaje debe tener entre 1 y ${MAX_MESSAGE_CHARS} caracteres`, "bad_params");
  }
  // De la bitácora solo salen el largo y una huella corta (sin el texto), para dejar evidencia sin guardar contenido.
  const sha = (await sha256HexOf(`${id}\n${mensaje}`)).slice(0, 16);
  return {
    path: `${path}/messages`,
    bridgeBody: { mensaje, autor_nombre: "Soporte (Kawiil Central)" },
    audit: { params: { id }, mensaje_len: mensaje.length, mensaje_sha256: sha },
    dedupeValue: sha,
  };
}

/** Escrituras permitidas: bandera explícita Y firma HMAC configurada Y puente configurado. */
function writesAvailable(cfg: BridgeConfig | { problems: string[] }): boolean {
  return Deno.env.get("MATI_GATEWAY_WRITES") === "on" && !("problems" in cfg) && cfg.hmacKey !== null;
}

type BridgeResult = { res: Response } | { failure: "timeout" | "unreachable" };

async function bridgeFetch(
  cfg: BridgeConfig,
  method: string,
  pathWithQuery: string,
  caller: { email: string | null; userId: string },
  bodyText?: string,
): Promise<BridgeResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
    "x-mati-actor": `kawiil:${caller.email ?? caller.userId}`.slice(0, 120),
  };
  if (bodyText !== undefined) headers["Content-Type"] = "application/json";
  if (cfg.hmacKey) {
    const bodySha = bodyText !== undefined ? await sha256HexOf(bodyText) : undefined;
    Object.assign(headers, await signRequestHeaders(cfg.hmacKey, method, pathWithQuery, bodySha));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url + pathWithQuery, {
      method,
      headers,
      signal: ctrl.signal,
      redirect: "manual",
      ...(bodyText !== undefined ? { body: bodyText } : {}),
    });
    return { res };
  } catch (e) {
    return { failure: e instanceof Error && e.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** El puente puede responder el objeto, o `{ data|ticket: {...} }`. */
function unwrapObject(payload: unknown): unknown {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    for (const k of ["data", "ticket"]) {
      const v = o[k];
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    }
  }
  return payload;
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
    const own = (o: object) => Object.prototype.hasOwnProperty.call(o, action);
    const readDef = own(ACTIONS) ? ACTIONS[action] : undefined;
    const writeDef = own(WRITES) ? WRITES[action] : undefined;
    if (!readDef && !writeDef) {
      detail = { reason: "unknown_action" };
      action = "unknown";
      return await finish("denied", 400, { error: "Acción no permitida", code: "unknown_action" });
    }

    // ---------- Escritura (Fase 3) ----------
    if (writeDef) {
      const wr = await parseWriteParams(action, body.params);
      detail = { ...wr.audit };

      if (Deno.env.get("MATI_GATEWAY_WRITES") !== "on") {
        detail = { ...detail, reason: "writes_disabled" };
        return await finish("denied", 403, { error: "Las escrituras hacia MATI están desactivadas", code: "writes_disabled" });
      }
      const cfg = bridgeConfig();
      const problems = "problems" in cfg
        ? cfg.problems
        : cfg.hmacKey === null ? ["MATI_GATEWAY_HMAC_KEY (obligatoria para escrituras)"] : [];
      if (problems.length) {
        detail = { ...detail, missing: problems };
        return await finish("not_configured", 503, { configured: false, problems });
      }
      const wcfg = cfg as BridgeConfig;

      if (await isRateLimited(svc, caller.userId, SYSTEM, MAX_WRITES, WINDOW_SECONDS, Object.keys(WRITES))) {
        return await finish("rate_limited", 429, { error: "Demasiados cambios seguidos. Intenta en un minuto.", code: "rate_limited" });
      }
      if (wr.dedupeValue && await hasRecentDuplicate(svc, {
        userId: caller.userId,
        system: SYSTEM,
        action,
        field: "mensaje_sha256",
        value: wr.dedupeValue,
        windowSec: DUPLICATE_WINDOW_SECONDS,
      })) {
        return await finish("denied", 409, { error: "Ya enviaste este mismo mensaje hace un momento", code: "duplicate" });
      }

      const result = await bridgeFetch(wcfg, writeDef.method, wr.path, caller, JSON.stringify(wr.bridgeBody));
      if ("failure" in result) {
        const timedOut = result.failure === "timeout";
        detail = { ...detail, upstream: result.failure };
        return await finish("error", timedOut ? 504 : 502, {
          error: timedOut ? "El sistema externo tardó demasiado en responder" : "No se pudo contactar al sistema externo",
          code: "upstream_unreachable",
        });
      }
      const res = result.res;
      if (!res.ok) {
        // El detalle del puente no se reenvía; solo se distinguen los casos que el usuario puede corregir.
        detail = { ...detail, upstream_status: res.status };
        await res.body?.cancel();
        if (res.status === 404) return await finish("error", 404, { error: "Ticket no encontrado en MATI", code: "not_found" });
        if (res.status === 400 || res.status === 409 || res.status === 422) {
          return await finish("error", 422, { error: "MATI no aceptó el cambio", code: "upstream_rejected" });
        }
        return await finish("error", 502, { error: "El sistema externo respondió con un error", code: "upstream_error" });
      }
      const payload: unknown = await res.json().catch(() => null);
      return await finish("ok", 200, {
        configured: true,
        data: pickFields(unwrapObject(payload), writeDef.fields),
        fetched_at: new Date().toISOString(),
      });
    }

    // ---------- Lectura (Fase 2) ----------
    const def = readDef!;
    const params = parseParams(action, body.params);
    detail = { params };

    const cfg = bridgeConfig();
    if ("problems" in cfg) {
      detail = { ...detail, missing: cfg.problems };
      // `status` informa qué falta (solo nombres de variables); el resto responde 503.
      return await finish(
        "not_configured",
        action === "status" ? 200 : 503,
        { configured: false, problems: cfg.problems, writes_enabled: false },
      );
    }

    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const qs = query.toString();
    const pathWithQuery = def.path + (qs ? `?${qs}` : "");
    const result = await bridgeFetch(cfg, "GET", pathWithQuery, caller);
    if ("failure" in result) {
      const timedOut = result.failure === "timeout";
      detail = { ...detail, upstream: result.failure };
      return await finish("error", timedOut ? 504 : 502, {
        error: timedOut ? "El sistema externo tardó demasiado en responder" : "No se pudo contactar al sistema externo",
        code: "upstream_unreachable",
      });
    }
    const res = result.res;

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
      writes_enabled: writesAvailable(cfg),
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return await finish(e.status === 403 ? "denied" : "error", e.status, { error: e.message, code: e.code });
    }
    console.error("integraciones-gateway:", e instanceof Error ? e.message : "error desconocido");
    return await finish("error", 500, { error: "Error interno", code: "internal" });
  }
});
