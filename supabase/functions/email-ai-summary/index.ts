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
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

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
      locale?: "es" | "en";
    };

    const subject = (payload.subject || "(sin asunto)").trim();
    const senderName = (payload.senderName || "Desconocido").trim();
    const senderEmail = (payload.senderEmail || "").trim();
    const bodyPlain = stripHtml(payload.body || "").slice(0, 6000);
    const threadPlain = stripHtml(payload.thread || "").slice(0, 4000);
    const locale = payload.locale === "en" ? "en" : "es";

    if (!bodyPlain) {
      return jsonResponse({ error: "empty_body", message: "El correo no tiene contenido para resumir." }, 400);
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

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
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

    return jsonResponse({
      summary,
      keyPoints,
      suggestedAction,
      model: DEFAULT_MODEL,
    });
  } catch (e) {
    console.error("email-ai-summary error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
