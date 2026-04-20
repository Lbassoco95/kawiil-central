import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * email-ai-quick-reply
 * --------------------
 * Devuelve 3 sugerencias de respuesta rápida (chips clickeables).
 * Pensada para alimentar la zona "Respuesta rápida" del rediseño v2.4 del módulo Correo.
 *
 * Body:
 *   {
 *     subject: string,
 *     senderName?: string,
 *     senderEmail?: string,
 *     body: string,            // puede venir como HTML
 *     thread?: string,
 *     userName?: string,       // primer nombre del usuario para firmas
 *     locale?: "es" | "en"
 *   }
 *
 * Respuesta:
 *   {
 *     suggestions: Array<{ id: string; label: string; tone: "professional"|"short"|"affirmative"|"declining"; body: string }>,
 *     model: string
 *   }
 *
 * Requiere `verify_jwt = true`. Usa ANTHROPIC_API_KEY.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Haiku por defecto (ver email-ai-summary). Override con KAWIIL_AI_FAST_MODEL.
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

async function callAnthropicOnce(args: {
  apiKey: string;
  model: string;
  maxTokens: number;
  system: string;
  userPrompt: string;
}): Promise<Response> {
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
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CACHE_SCOPE = "email-quick-reply";

function tryParseJsonFromText(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* try slice */
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const requesterClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await requesterClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const payload = (await req.json().catch(() => ({}))) as {
      subject?: string;
      senderName?: string;
      senderEmail?: string;
      body?: string;
      thread?: string;
      userName?: string;
      locale?: "es" | "en";
    };

    const subject = (payload.subject || "(sin asunto)").trim();
    const senderName = (payload.senderName || "Desconocido").trim();
    const senderEmail = (payload.senderEmail || "").trim();
    const userName = (payload.userName || "").trim();
    const bodyPlain = stripHtml(payload.body || "").slice(0, 1800);
    const threadPlain = stripHtml(payload.thread || "").slice(0, 400);
    const locale = payload.locale === "en" ? "en" : "es";

    if (!bodyPlain) return jsonResponse({ error: "empty_body" }, 400);

    // Caché server-side compartido por hash (scope="email-quick-reply").
    const cacheKey = await sha256Hex(`${locale}|${userName}|${subject}|${senderEmail}|${bodyPlain}|${threadPlain}`);
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const serviceClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : null;

    if (serviceClient) {
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
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const systemPrompt = locale === "en"
      ? "You generate quick reply suggestions for an email client. Always respond ONLY with a valid JSON object, no markdown."
      : "Generas sugerencias de respuesta rápida para un cliente de correo. Responde SIEMPRE únicamente con un objeto JSON válido, sin markdown.";

    const userPrompt = locale === "en"
      ? `Generate 3 short, ready-to-send reply drafts to this email. Vary tone but keep them all polite and professional. The user replying is "${userName || "the user"}".

Email:
- Subject: ${subject}
- From: ${senderName} <${senderEmail}>
- Body:
${bodyPlain}
${threadPlain ? `- Recent thread:\n${threadPlain}` : ""}

Constraints for each "body":
- 2 to 5 short sentences max
- No subject line, no greeting beyond "Hi <name>," / "Hello," — sign as "${userName || "Best,"}" only if natural
- Plain text (no markdown)
- DO NOT invent facts, dates or commitments not present in the email

Return EXACTLY this JSON shape (no other keys, no commentary):
{
  "suggestions": [
    { "id": "professional", "label": "Respuesta profesional", "tone": "professional", "body": "..." },
    { "id": "short", "label": "Respuesta breve", "tone": "short", "body": "..." },
    { "id": "affirmative", "label": "Confirmar / aceptar", "tone": "affirmative", "body": "..." }
  ]
}`
      : `Genera 3 borradores cortos de respuesta listos para enviar a este correo. Varía el tono pero mantén todos cordiales y profesionales en español. Quien responde es "${userName || "el usuario"}".

Correo:
- Asunto: ${subject}
- De: ${senderName} <${senderEmail}>
- Cuerpo:
${bodyPlain}
${threadPlain ? `- Hilo reciente:\n${threadPlain}` : ""}

Reglas para cada "body":
- Máximo 2 a 5 oraciones cortas
- Sin asunto, sin saludo más allá de "Hola <nombre>," — firma como "${userName || "Saludos"}" solo si suena natural
- Texto plano (sin markdown)
- NO inventes hechos, fechas, montos ni compromisos que no estén en el correo
- Si el correo contiene una pregunta clara, responde a ella

Devuelve EXACTAMENTE este JSON (sin otras llaves, sin comentarios, sin fences):
{
  "suggestions": [
    { "id": "professional", "label": "Respuesta profesional", "tone": "professional", "body": "..." },
    { "id": "short", "label": "Respuesta breve", "tone": "short", "body": "..." },
    { "id": "affirmative", "label": "Confirmar / aceptar", "tone": "affirmative", "body": "..." }
  ]
}`;

    const aiResp = await callAnthropicOnce({
      apiKey: ANTHROPIC_API_KEY,
      model: DEFAULT_MODEL,
      maxTokens: 900,
      system: systemPrompt,
      userPrompt,
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("email-ai-quick-reply anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";
    const parsed = tryParseJsonFromText(text);
    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return jsonResponse({ error: "ai_parse_error", raw: text.slice(0, 600) }, 502);
    }

    const suggestions = (parsed.suggestions as Array<Record<string, unknown>>)
      .map((s) => ({
        id: String(s.id || s.tone || "suggestion"),
        label: String(s.label || "Sugerencia"),
        tone: (["professional", "short", "affirmative", "declining"].includes(String(s.tone))
          ? String(s.tone)
          : "professional") as "professional" | "short" | "affirmative" | "declining",
        body: typeof s.body === "string" ? s.body.trim() : "",
      }))
      .filter((s) => s.body.length > 0)
      .slice(0, 4);

    const payloadOut = { suggestions };
    if (serviceClient) {
      serviceClient
        .from("ai_response_cache")
        .upsert({
          scope: CACHE_SCOPE,
          cache_key: cacheKey,
          response: payloadOut,
          model: DEFAULT_MODEL,
        })
        .then(({ error }) => {
          if (error) console.warn("email-ai-quick-reply cache upsert failed", error.message);
        });
    }

    return jsonResponse({ ...payloadOut, model: DEFAULT_MODEL, cached: false });
  } catch (e) {
    console.error("email-ai-quick-reply error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
