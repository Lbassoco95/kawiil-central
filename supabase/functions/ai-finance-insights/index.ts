/**
 * Briefing financiero con Claude: interpreta un snapshot agregado (sin payloads crudos Savio).
 * Requiere JWT + RPC can_view_savio_finance. Secret: ANTHROPIC_API_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function modelId(): string {
  return (Deno.env.get("AI_FINANCE_INSIGHTS_MODEL") || "").trim() || "claude-3-5-haiku-20241022";
}

type Snapshot = Record<string, unknown>;

const MAX_SNAPSHOT_CHARS = 14_000;

function isPlainSnapshot(v: unknown): v is Snapshot {
  return v !== null && typeof v === "object" && !Array.isArray(v);
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
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, skip: "no_anthropic" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: savioOk } = await admin.rpc("can_view_savio_finance", { _user_id: user.id });
    if (!savioOk) {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "No tienes permiso para análisis de ingresos Savio.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: { snapshot?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const snap = body.snapshot;
    if (!isPlainSnapshot(snap)) {
      return new Response(JSON.stringify({ error: "snapshot requerido (objeto)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serialized = JSON.stringify(snap);
    if (serialized.length > MAX_SNAPSHOT_CHARS) {
      return new Response(JSON.stringify({ error: "snapshot demasiado grande" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system =
      "Eres un analista financiero interno para Kawiil (despacho de servicios profesionales en México). " +
      "Los números del usuario son la fuente de verdad: no los recalcules ni contradigas. " +
      "Explica en español de México, tono profesional y directo. " +
      "Indica limitaciones (p. ej. datos truncados o sin balance contable completo) cuando el snapshot lo mencione.";

    const userMsg =
      "Con el siguiente JSON agregado del tablero financiero, elabora:\n" +
      "1) Un párrafo de resumen ejecutivo (máx. 120 palabras).\n" +
      "2) Una lista con viñetas de 3 a 7 acciones concretas (cobros, costos, seguimiento a clientes).\n" +
      "3) Si hay riesgos de cobranza o concentración de ingresos, menciónalos brevemente.\n\n" +
      "Responde en Markdown (## Resumen, ## Acciones recomendadas, ## Riesgos opcional).\n\n" +
      "```json\n" +
      serialized +
      "\n```";

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId(),
        max_tokens: 1_200,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.warn("ai-finance-insights anthropic:", resp.status, t.slice(0, 400));
      return new Response(JSON.stringify({ ok: false, error: "model_error" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const markdown =
      (data.content?.find((b: { type?: string }) => b.type === "text") as { text?: string } | undefined)?.text
        ?.trim() || "";

    return new Response(JSON.stringify({ ok: true, markdown }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-finance-insights:", e);
    return new Response(JSON.stringify({ ok: false, error: "internal" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
