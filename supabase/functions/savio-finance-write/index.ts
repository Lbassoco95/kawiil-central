import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { savioAuthorizationHeaderValue } from "../_shared/savioAuthHeaders.ts";
import { normalizeSavioApiBase } from "../_shared/savioApiBase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_CHARS = 120_000;
const MAX_RESPONSE_LOG_CHARS = 4000;

/**
 * Cobros recurrentes / suscripciones: no hay operación genérica hasta alinear con OpenAPI (app.savio.mx/docs).
 * Cuando exista ruta estable (p. ej. POST /subscription o flags en /invoice), añadir aquí p. ej.
 * `create_recurring_invoice` → path + requiredKeys documentados en comentario y en savioWriteOperations.ts.
 *
 * Operaciones de escritura hacia Savio. Rutas alineadas con GET existente (/invoice, /payment).
 * Los nombres de campos en `payload` deben coincidir con la OpenAPI de tu entorno (app.savio.mx/docs);
 * si Savio devuelve 4xx, revisar documentación y ajustar whitelist en este archivo.
 * Los IDs de factura/cliente suelen obtenerse con GET /invoice y GET /customer (vía savio-finance-api en Kawiil).
 * Requiere RPC `can_write_savio_finance`. La paginación extra del resumen financiero se configura en el front (Vite),
 * no en secrets de Edge; ver `.env.example` del repositorio.
 */
const OPERATIONS: Record<
  string,
  { method: "POST"; path: string; requiredKeys: string[]; allowedKeys: string[] }
> = {
  create_payment: {
    method: "POST",
    path: "/payment",
    requiredKeys: ["invoice_id", "amount_paid"],
    allowedKeys: [
      "invoice_id",
      "amount_paid",
      "payment_date",
      "reference",
      "notes",
      "payment_method",
      "customer_id",
      "currency",
    ],
  },
  create_invoice: {
    method: "POST",
    path: "/invoice",
    requiredKeys: ["customer_id"],
    allowedKeys: [
      "customer_id",
      "amount_total",
      "due_date",
      "invoice_date",
      "description",
      "currency",
      "items",
      "concepts",
    ],
  },
  create_customer: {
    method: "POST",
    path: "/customer",
    requiredKeys: [],
    allowedKeys: [
      "name",
      "legal_name",
      "company_name",
      "email",
      "phone",
      "tax_id",
      "rfc",
      "address",
      "currency",
      "metadata",
    ],
  },
};

function isAllowedSavioRelativePath(path: string): boolean {
  const pathOnly = path.split("?")[0].trim();
  if (!pathOnly.startsWith("/") || pathOnly.includes("..")) return false;
  return /^\/[a-zA-Z0-9/_{}\-]+$/.test(pathOnly);
}

function pickBody(
  payload: unknown,
  allowedKeys: string[],
): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const o = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined) {
      out[k] = o[k];
    }
  }
  return out;
}

function summarizeRequest(body: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(body);
  const amount =
    typeof body.amount_paid === "number"
      ? body.amount_paid
      : typeof body.amount_total === "number"
        ? body.amount_total
        : null;
  const nameHint =
    typeof body.name === "string"
      ? body.name
      : typeof body.legal_name === "string"
        ? body.legal_name
        : typeof body.company_name === "string"
          ? body.company_name
          : null;
  return { keys, invoice_id: body.invoice_id, customer_id: body.customer_id, amount, name_hint: nameHint };
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
    const { data: writeOk } = await adminClient.rpc("can_write_savio_finance", { _user_id: user.id });
    if (!writeOk) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "forbidden",
          message:
            "No tienes permiso de escritura Savio en Kawiil. Los transformadores con «Ver ingresos / Savio» lo tienen por defecto; otros roles necesitan que un referente o transformador active «Crear cargos y registrar pagos» en tu usuario (no depende del rol admin en app.savio.mx).",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: { operation?: string; payload?: unknown };
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_CHARS) {
        return new Response(JSON.stringify({ ok: false, error: "body_too_large" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = text ? JSON.parse(text) : {};
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const operation = typeof body.operation === "string" ? body.operation.trim() : "";
    const spec = OPERATIONS[operation];
    if (!spec || !isAllowedSavioRelativePath(spec.path)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "unknown_operation",
          message: `Operación no permitida: ${operation || "(vacía)"}. Use create_payment, create_invoice o create_customer. Recurrentes: gestionar en Savio hasta nueva ruta confirmada en docs.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const filtered = pickBody(body.payload, spec.allowedKeys);
    for (const reqKey of spec.requiredKeys) {
      if (!(reqKey in filtered)) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "validation_error",
            message: `Falta el campo obligatorio: ${reqKey}`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (operation === "create_payment") {
      const ap = filtered.amount_paid;
      if (typeof ap !== "number" || !Number.isFinite(ap) || ap <= 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "validation_error",
            message: "amount_paid debe ser un número mayor que cero.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const inv = filtered.invoice_id;
      if (typeof inv !== "string" || !inv.trim()) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "validation_error",
            message: "invoice_id debe ser un identificador de cargo válido (texto).",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (operation === "create_customer") {
      const n =
        typeof filtered.name === "string" && filtered.name.trim()
          ? filtered.name.trim()
          : typeof filtered.legal_name === "string" && filtered.legal_name.trim()
            ? filtered.legal_name.trim()
            : typeof filtered.company_name === "string" && filtered.company_name.trim()
              ? filtered.company_name.trim()
              : "";
      if (!n) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "validation_error",
            message:
              "Para crear un cliente incluye al menos name, legal_name o company_name (texto no vacío), según OpenAPI Savio.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (operation === "create_invoice") {
      const cid = filtered.customer_id;
      if (typeof cid !== "string" || !cid.trim()) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "validation_error",
            message: "customer_id debe ser un identificador de cliente válido (texto).",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const hasAmount = typeof filtered.amount_total === "number" && Number.isFinite(filtered.amount_total);
      const hasItems = Array.isArray(filtered.items) && filtered.items.length > 0;
      const hasConcepts = Array.isArray(filtered.concepts) && filtered.concepts.length > 0;
      if (!hasAmount && !hasItems && !hasConcepts) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "validation_error",
            message:
              "Para crear un cargo incluye amount_total o un arreglo items o concepts (según documentación Savio).",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const base = normalizeSavioApiBase(Deno.env.get("SAVIO_API_BASE_URL") || "");
    const apiKey = Deno.env.get("SAVIO_API_KEY");
    const missing: string[] = [];
    if (!base) missing.push("SAVIO_API_BASE_URL");
    if (!apiKey) missing.push("SAVIO_API_KEY");
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_secrets",
          missing,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = `${base}${spec.path}`;
    const idempotencyKey = crypto.randomUUID();
    const savioRes = await fetch(url, {
      method: spec.method,
      headers: {
        Authorization: savioAuthorizationHeaderValue(apiKey),
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(filtered),
    });

    const resText = await savioRes.text();
    let parsed: unknown = null;
    try {
      parsed = resText ? JSON.parse(resText) : null;
    } catch {
      parsed = { _raw: resText.slice(0, 2000) };
    }

    const orgIdRow = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const organizationId = orgIdRow.data?.organization_id ?? null;

    if (organizationId) {
      const excerpt = resText.length > MAX_RESPONSE_LOG_CHARS
        ? resText.slice(0, MAX_RESPONSE_LOG_CHARS) + "…"
        : resText;
      await adminClient.from("savio_write_log").insert({
        organization_id: organizationId,
        user_id: user.id,
        operation,
        savio_path: spec.path,
        request_summary: summarizeRequest(filtered),
        savio_http_status: savioRes.status,
        ok: savioRes.ok,
        error_message: savioRes.ok ? null : typeof parsed === "object" && parsed && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : resText.slice(0, 500),
        savio_response_excerpt: savioRes.ok ? null : excerpt,
      });
    }

    return new Response(
      JSON.stringify({
        ok: savioRes.ok,
        savio_http_status: savioRes.status,
        operation,
        path: spec.path,
        data: parsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("savio-finance-write:", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
