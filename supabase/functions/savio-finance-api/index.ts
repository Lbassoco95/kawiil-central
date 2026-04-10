import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { savioAuthorizationHeaderValue } from "../_shared/savioAuthHeaders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Solo estas acciones; rutas configurables por secreto si Savio cambia el path. */
const DEFAULT_PATHS: Record<string, string> = {
  invoices: "/api/v1/invoices",
  payments: "/api/v1/payments",
  customers: "/api/v1/customers",
};

const ALLOWED_QUERY_KEYS = new Set([
  "limit",
  "page",
  "offset",
  "per_page",
  "status",
  "from",
  "to",
  "sort",
  "order",
  "search",
  "q",
]);

const MAX_RESPONSE_CHARS = 1_500_000;

function pathForAction(action: string): string | null {
  const envKey = `SAVIO_API_PATH_${action.toUpperCase()}`;
  const fromEnv = Deno.env.get(envKey);
  const raw = (fromEnv || DEFAULT_PATHS[action] || "").trim();
  if (!raw || !raw.startsWith("/api/") || raw.includes("..")) return null;
  return raw;
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

    let body: { action?: string; query?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const action = typeof body.action === "string" ? body.action.trim() : "";
    const relPath = pathForAction(action);
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

    const base = (Deno.env.get("SAVIO_API_BASE_URL") || "").replace(/\/$/, "");
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
