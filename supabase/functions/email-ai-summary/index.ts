import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * email-ai-summary
 * ----------------
 * Resumen ejecutivo + puntos clave + sugerencia de acción para un correo.
 * Pensada para alimentar la card "Kawiil AI · Resumen" del rediseño v2.4 del módulo Correo.
 *
 * Body:
 *   {
 *     subject: string,
 *     senderName?: string,
 *     senderEmail?: string,
 *     body: string,           // puede venir como HTML; aquí lo aplanamos
 *     thread?: string,        // contexto adicional opcional
 *     locale?: "es" | "en"    // default es
 *   }
 *
 * Respuesta:
 *   {
 *     summary: string,
 *     keyPoints: string[],
 *     suggestedAction: string | null,
 *     model: string
 *   }
 *
 * Requiere `verify_jwt = true` (ver supabase/config.toml). Usa ANTHROPIC_API_KEY.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Haiku por defecto: resúmenes cortos, barato, mayor TPM. Sonnet 4 (30k TPM en tier 1)
// revienta el rate limit rápido con hilos grandes. Override con KAWIIL_AI_FAST_MODEL.
const DEFAULT_MODEL =
  Deno.env.get("KAWIIL_AI_FAST_MODEL")?.trim() || "claude-haiku-4-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Llama a Anthropic. Un solo intento: con tier 1 apretado los reintentos
 * server-side amplifican la carga (cada click = N llamadas) y empeoran los
 * 429. La capa de caché + semáforo client-side es quien protege al tier.
 */
async function callAnthropicOnce(args: {
  apiKey: string;
  model: string;
  maxTokens: number;
  system: string;
  userPrompt: string;
}): Promise<Response> {
  // Tope duro de 25s — si Anthropic tarda más, preferimos devolver error al
  // cliente (que tiene su propio timeout de 30s) a que el isolate cuelgue.
  return await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: [{ role: "user", content: args.userPrompt }],
    }),
    signal: AbortSignal.timeout(25_000),
  });
}

/** SHA-256 del contenido fuente — llave de caché en `public.ai_response_cache`. */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CACHE_SCOPE = "email-summary";

function tryParseJsonFromText(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // El modelo puede envolverlo en ```json ... ```
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = fenced ? fenced[1] : text;
  // intenta parsear directo
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* intenta recortar al primer/último { } */
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    // NOTA: `verify_jwt = true` en supabase/config.toml hace que el gateway
    // valide el JWT antes de invocar esta función. No llamamos `auth.getUser()`
    // aquí porque el roundtrip HTTP a /auth/v1/user cuelga el isolate bajo
    // carga (connection reset) y no necesitamos el objeto user.

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const payload = (await req.json().catch(() => ({}))) as {
      subject?: string;
      senderName?: string;
      senderEmail?: string;
      body?: string;
      thread?: string;
      locale?: "es" | "en";
    };

    const subject = (payload.subject || "(sin asunto)").trim();
    const senderName = (payload.senderName || "Desconocido").trim();
    const senderEmail = (payload.senderEmail || "").trim();
    const bodyPlain = stripHtml(payload.body || "").slice(0, 2200);
    const threadPlain = stripHtml(payload.thread || "").slice(0, 600);
    const locale = payload.locale === "en" ? "en" : "es";

    if (!bodyPlain) {
      return jsonResponse({ error: "empty_body", message: "El correo no tiene contenido para resumir." }, 400);
    }

    // ───────── Caché server-side por hash del contenido ─────────
    // Evita llamar a Anthropic si ya resumimos exactamente este correo antes
    // (para cualquier usuario / dispositivo). Absorbe los 429 del tier 1.
    const cacheKey = await sha256Hex(`${locale}|${subject}|${senderEmail}|${bodyPlain}|${threadPlain}`);
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const serviceClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : null;

    if (serviceClient) {
      // Lectura best-effort: si la DB tarda o falla, seguimos a Anthropic.
      try {
        const { data: cached } = await serviceClient
          .from("ai_response_cache")
          .select("response, model")
          .eq("scope", CACHE_SCOPE)
          .eq("cache_key", cacheKey)
          .maybeSingle();
        if (cached?.response) {
          return jsonResponse({
            ...cached.response,
            model: cached.model || DEFAULT_MODEL,
            cached: true,
          });
        }
      } catch (cacheErr) {
        console.error("email-ai-summary cache read failed", cacheErr);
      }
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const systemPrompt = locale === "en"
      ? "You are an executive email assistant for Kawiil OS. Always respond ONLY with a valid JSON object, no prose, no markdown fences."
      : "Eres un asistente ejecutivo de correo para Kawiil OS. Responde SIEMPRE únicamente con un objeto JSON válido, sin texto adicional ni fences markdown.";

    const userPrompt = locale === "en"
      ? `Summarize this email for a busy professional. Be concrete, neutral and short.

Email:
- Subject: ${subject}
- From: ${senderName} <${senderEmail}>
- Body:
${bodyPlain}
${threadPlain ? `- Recent thread:\n${threadPlain}` : ""}

Return strictly this JSON shape (no other keys, no commentary):
{
  "summary": "2-3 sentence executive summary",
  "keyPoints": ["max 4 short bullet points capturing facts, dates, amounts, requests"],
  "suggestedAction": "one short imperative sentence with the next best action, or null if nothing to do"
}`
      : `Resume este correo para un profesional ocupado. Sé concreto, neutro y breve. NO inventes datos.

Correo:
- Asunto: ${subject}
- De: ${senderName} <${senderEmail}>
- Cuerpo:
${bodyPlain}
${threadPlain ? `- Hilo reciente:\n${threadPlain}` : ""}

Devuelve EXACTAMENTE este JSON (sin otras llaves, sin comentarios, sin fences):
{
  "summary": "Resumen ejecutivo de 2-3 oraciones",
  "keyPoints": ["máximo 4 viñetas cortas con hechos, fechas, montos, solicitudes"],
  "suggestedAction": "una sola oración imperativa con la próxima acción recomendada, o null si no hay nada que hacer"
}`;

    const aiResp = await callAnthropicOnce({
      apiKey: ANTHROPIC_API_KEY,
      model: DEFAULT_MODEL,
      maxTokens: 500,
      system: systemPrompt,
      userPrompt,
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("email-ai-summary anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";
    const parsed = tryParseJsonFromText(text);
    if (!parsed) {
      return jsonResponse({ error: "ai_parse_error", raw: text.slice(0, 600) }, 502);
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const keyPointsRaw = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
    const keyPoints = keyPointsRaw
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0)
      .slice(0, 6);
    const suggestedAction =
      typeof parsed.suggestedAction === "string" && parsed.suggestedAction.trim().length > 0
        ? parsed.suggestedAction.trim()
        : null;

    const payloadOut = { summary, keyPoints, suggestedAction };
    // Guarda en caché (best-effort, no frena la respuesta si falla).
    if (serviceClient) {
      try {
        serviceClient
          .from("ai_response_cache")
          .upsert({
            scope: CACHE_SCOPE,
            cache_key: cacheKey,
            response: payloadOut,
            model: DEFAULT_MODEL,
          })
          .then(({ error }) => {
            if (error) console.warn("email-ai-summary cache upsert failed", error.message);
          })
          .catch((err) => console.warn("email-ai-summary cache upsert threw", err));
      } catch (cacheErr) {
        console.warn("email-ai-summary cache upsert sync threw", cacheErr);
      }
    }

    return jsonResponse({
      ...payloadOut,
      model: DEFAULT_MODEL,
      cached: false,
    });
  } catch (e) {
    console.error("email-ai-summary error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
