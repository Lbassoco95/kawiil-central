/**
 * savio-finance-api — lectura GET hacia Savio (/invoice, /payment, /customer).
 *
 * Detalle por id (si tu OpenAPI lo expone): mismo `action` (`invoices` | `payments` | `customers`) y en el cuerpo
 * `resourceId` con el id del recurso → GET `/invoice/{id}` (o `/payment/{id}`, `/customer/{id}`). Ver app.savio.mx/docs.
 *
 * Requiere JWT de usuario y RPC `can_view_savio_finance`. Escritura: función `savio-finance-write` + RPC
 * `can_write_savio_finance` (ver migración savio_finance_write).
 *
 * El resumen financiero en el front pagina en el cliente; topes y «cargar más» se configuran con variables Vite
 * documentadas en `.env.example` (VITE_SAVIO_FINANCE_MAX_PAGES, etc.), no en secrets de Edge.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { savioAuthorizationHeaderValue } from "../_shared/savioAuthHeaders.ts";
import { normalizeSavioApiBase } from "../_shared/savioApiBase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Rutas según OpenAPI Savio (prod y sandbox): GET /invoice, /payment, /customer — no /api/v1/... */
const DEFAULT_PATHS: Record<string, string> = {
  invoices: "/invoice",
  payments: "/payment",
  customers: "/customer",
};

const ALLOWED_QUERY_KEYS = new Set([
  "limit",
  "cursor",
  "page",
  "offset",
  "per_page",
  "status",
  "from",
  "to",
  "start_date",
  "end_date",
  "min_days_late",
  "sort",
  "order",
  "search",
  "q",
  "customer_id",
]);

const MAX_RESPONSE_CHARS = 1_500_000;

function isAllowedSavioRelativePath(path: string): boolean {
  const pathOnly = path.split("?")[0].trim();
  if (!pathOnly.startsWith("/") || pathOnly.includes("..")) return false;
  return /^\/[a-zA-Z0-9/_{}\-]+$/.test(pathOnly);
}

/** Segmento de id para GET /recurso/{id} (evita path traversal). */
function safeSavioResourceId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const t = id.trim();
  if (t.length < 4 || t.length > 128) return null;
  if (!/^[a-zA-Z0-9\-_.]+$/.test(t)) return null;
  return t;
}

const ACTIONS_WITH_DETAIL: Record<string, true> = {
  invoices: true,
  payments: true,
  customers: true,
};

function pathForAction(action: string): string | null {
  const envKey = `SAVIO_API_PATH_${action.toUpperCase()}`;
  const fromEnv = Deno.env.get(envKey);
  const raw = (fromEnv || DEFAULT_PATHS[action] || "").trim();
  if (!raw || !isAllowedSavioRelativePath(raw)) return null;
  return raw.split("?")[0];
}

function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params || typeof params !== "object") return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!ALLOWED_QUERY_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    const s = String(v).slice(0, 200);
    if (s) sp.set(k, s);
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: savioOk } = await adminClient.rpc("can_view_savio_finance", { _user_id: user.id });
    if (!savioOk) {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "No tienes permiso para ver ingresos Savio. Solicita acceso en finance_income_viewers.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: { action?: string; query?: Record<string, unknown>; resourceId?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const action = typeof body.action === "string" ? body.action.trim() : "";
    let relPath = pathForAction(action);
    if (!relPath) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "unknown_action",
          message: `Acción no permitida: ${action || "(vacía)"}. Use invoices, payments o customers.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rid = safeSavioResourceId(body.resourceId);
    if (body.resourceId !== undefined && body.resourceId !== null && String(body.resourceId).trim() !== "") {
      if (!rid || !ACTIONS_WITH_DETAIL[action]) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "invalid_resource_id",
            message:
              "resourceId inválido o acción sin detalle por id. Use solo letras, números, guiones y puntos (4–128 caracteres) con action invoices, payments o customers.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      relPath = `${relPath}/${encodeURIComponent(rid)}`;
      if (!isAllowedSavioRelativePath(relPath)) {
        return new Response(JSON.stringify({ ok: false, error: "invalid_path" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const base = normalizeSavioApiBase(Deno.env.get("SAVIO_API_BASE_URL") || "");
    const apiKey = Deno.env.get("SAVIO_API_KEY");
    const missing: string[] = [];
    if (!base) missing.push("SAVIO_API_BASE_URL");
    if (!apiKey) missing.push("SAVIO_API_KEY");
    if (missing.length > 0) {
      //200 para que el cliente JS reciba el cuerpo JSON (evita FunctionsHttpError / pantalla en blanco en Lovable).
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_secrets",
          missing,
          hint: "Supabase Dashboard → Project Settings → Edge Functions → Secrets",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = `${base}${relPath}${buildQuery(body.query)}`;
    const savioRes = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: savioAuthorizationHeaderValue(apiKey),
        Accept: "application/json",
      },
    });

    const text = await savioRes.text();
    if (text.length > MAX_RESPONSE_CHARS) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "response_too_large",
          savio_http_status: savioRes.status,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { _raw: text.slice(0, 2000) };
    }

    // Siempre 200 para que supabase.functions.invoke devuelva `data` (evita pantalla en blanco en Lovable).
    return new Response(
      JSON.stringify({
        ok: savioRes.ok,
        savio_http_status: savioRes.status,
        action,
        path: relPath,
        data: parsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("savio-finance-api:", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
