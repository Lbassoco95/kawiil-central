/**
 * Borrador de correo con Claude (ANTHROPIC_API_KEY). Deploy:
 * supabase functions deploy ai-email-draft --project-ref qppfampapbxdgednkofc
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  "Eres un asistente de redacción de correos profesionales en español para Kawiil, un despacho de servicios legales y contables. Redacta correos claros, concisos y profesionales. Responde SOLO con el cuerpo del correo, sin saludos iniciales duplicados ni firmas.";

type DraftBody = {
  action?: string;
  instruction?: string;
  context?: { subject?: string; to?: string };
  tone?: string;
};

function formatContext(ctx: DraftBody["context"]): string {
  if (!ctx || typeof ctx !== "object") return "Asunto: (no indicado)\nDestinatario(s): (no indicado)";
  const subject = typeof ctx.subject === "string" && ctx.subject.trim() ? ctx.subject.trim() : "(sin asunto)";
  const to = typeof ctx.to === "string" && ctx.to.trim() ? ctx.to.trim() : "(no indicado)";
  return `Asunto: ${subject}\nDestinatario(s): ${to}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
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
    const requester = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await requester.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as DraftBody;
    if (body.action !== "draft") {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const instruction = (body.instruction || "").trim();
    if (!instruction) {
      return new Response(JSON.stringify({ error: "instruction is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tone = (body.tone || "formal").trim() || "formal";
    const contextBlock = formatContext(body.context);

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "ANTHROPIC_API_KEY no configurada",
          message: "Configura el secreto ANTHROPIC_API_KEY en Edge Functions (Supabase).",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userMessage = `Tono: ${tone}

Contexto del borrador:
${contextBlock}

Instrucción del usuario:
${instruction}`;

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text();
      console.error("Anthropic error:", aiResp.status, text);
      return new Response(
        JSON.stringify({
          error: "Error al generar el borrador",
          message: text.replace(/\s+/g, " ").slice(0, 500),
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await aiResp.json();
    const raw =
      aiData.content?.find?.((b: { type?: string; text?: string }) => b.type === "text")?.text?.trim() || "";

    return new Response(JSON.stringify({ text: raw }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("ai-email-draft:", msg);
    return new Response(
      JSON.stringify({ error: "Error interno", message: msg.replace(/\s+/g, " ").slice(0, 400) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
