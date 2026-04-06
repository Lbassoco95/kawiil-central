/**
 * Borrador / resumen / traducción de correo con Claude (ANTHROPIC_API_KEY). Deploy:
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

const SYSTEM_DRAFT =
  "Eres un asistente de redacción de correos profesionales en español para Kawiil, un despacho de servicios legales y contables. Redacta correos claros, concisos y profesionales. Responde SOLO con el cuerpo del correo, sin saludos iniciales duplicados ni firmas.";

const SYSTEM_SUMMARIZE =
  "Resume el siguiente correo electrónico en 2-3 oraciones concisas en español.";

const SYSTEM_TRANSLATE =
  "Traduce el siguiente correo. Si está en español, tradúcelo al inglés. Si está en inglés, tradúcelo al español. Solo devuelve la traducción.";

type RequestBody = {
  action?: string;
  instruction?: string;
  context?: { subject?: string; to?: string };
  tone?: string;
  emailBody?: string;
  emailSubject?: string;
  targetLanguage?: string;
};

function formatContext(ctx: RequestBody["context"]): string {
  if (!ctx || typeof ctx !== "object") return "Asunto: (no indicado)\nDestinatario(s): (no indicado)";
  const subject = typeof ctx.subject === "string" && ctx.subject.trim() ? ctx.subject.trim() : "(sin asunto)";
  const to = typeof ctx.to === "string" && ctx.to.trim() ? ctx.to.trim() : "(no indicado)";
  return `Asunto: ${subject}\nDestinatario(s): ${to}`;
}

async function callAnthropic(
  apiKey: string,
  system: string,
  userMessage: string,
  maxTokens: number,
): Promise<string> {
  const aiResp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!aiResp.ok) {
    const text = await aiResp.text();
    console.error("Anthropic error:", aiResp.status, text);
    throw new Error(text.replace(/\s+/g, " ").slice(0, 500));
  }

  const aiData = await aiResp.json();
  return (
    aiData.content?.find?.((b: { type?: string; text?: string }) => b.type === "text")?.text?.trim() || ""
  );
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

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const action = (body.action || "").trim();

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

    if (action === "draft") {
      const instruction = (body.instruction || "").trim();
      if (!instruction) {
        return new Response(JSON.stringify({ error: "instruction is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const tone = (body.tone || "formal").trim() || "formal";
      const contextBlock = formatContext(body.context);
      const userMessage = `Tono: ${tone}

Contexto del borrador:
${contextBlock}

Instrucción del usuario:
${instruction}`;

      try {
        const raw = await callAnthropic(ANTHROPIC_API_KEY, SYSTEM_DRAFT, userMessage, 4096);
        return new Response(JSON.stringify({ text: raw }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(
          JSON.stringify({ error: "Error al generar el borrador", message: msg.slice(0, 500) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (action === "summarize") {
      const emailBody = (body.emailBody || "").trim();
      if (!emailBody) {
        return new Response(JSON.stringify({ error: "emailBody is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const subj = typeof body.emailSubject === "string" ? body.emailSubject.trim() : "";
      const userMessage = subj
        ? `Asunto del correo: ${subj}\n\nContenido:\n${emailBody}`
        : `Contenido:\n${emailBody}`;

      try {
        const raw = await callAnthropic(ANTHROPIC_API_KEY, SYSTEM_SUMMARIZE, userMessage, 1024);
        return new Response(JSON.stringify({ text: raw }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(
          JSON.stringify({ error: "Error al resumir", message: msg.slice(0, 500) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (action === "translate") {
      const emailBody = (body.emailBody || "").trim();
      if (!emailBody) {
        return new Response(JSON.stringify({ error: "emailBody is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const target = (body.targetLanguage || "").trim().toLowerCase();
      const hint =
        target === "en" || target === "english" || target === "inglés"
          ? "\n\n(El cliente solicitó salida en inglés.)"
          : target === "es" || target === "spanish" || target === "español"
          ? "\n\n(El cliente solicitó salida en español.)"
          : "";

      const userMessage = `Correo a traducir:${hint}\n\n${emailBody}`;

      try {
        const raw = await callAnthropic(ANTHROPIC_API_KEY, SYSTEM_TRANSLATE, userMessage, 8192);
        return new Response(JSON.stringify({ text: raw }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(
          JSON.stringify({ error: "Error al traducir", message: msg.slice(0, 500) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(JSON.stringify({ error: "Invalid action", message: `Unknown action: ${action}` }), {
      status: 400,
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
