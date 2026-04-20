import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * slack-ai-summary
 * ----------------
 * Resumen ejecutivo + pendientes + decisiones para los últimos N mensajes
 * de un canal/DM/MPIM. Pensada para alimentar la card "Kawiil AI · Resumen del canal"
 * del rediseño v2.4 del módulo Slack.
 *
 * Body:
 *   {
 *     channelTitle: string,
 *     channelType?: "channel" | "private" | "im" | "mpim",
 *     messages: Array<{ author: string; text: string; ts?: string; isMine?: boolean }>,
 *     locale?: "es" | "en"   // default es
 *   }
 *
 * Respuesta:
 *   {
 *     summary: string,
 *     pendings: string[],          // pendientes / acciones por hacer
 *     decisions: string[],         // decisiones tomadas
 *     suggestedAction: string|null,
 *     model: string
 *   }
 *
 * Requiere `verify_jwt = true` (ver supabase/config.toml). Usa ANTHROPIC_API_KEY.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL =
  Deno.env.get("KAWIIL_AI_FAST_MODEL")?.trim() || "claude-haiku-4-5";
const MAX_MESSAGES = 80;
const MAX_TEXT_PER_MSG = 600;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

function sanitize(t: string): string {
  return (t || "")
    .replace(/```/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_PER_MSG);
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
      channelTitle?: string;
      channelType?: "channel" | "private" | "im" | "mpim";
      messages?: Array<{ author?: string; text?: string; ts?: string; isMine?: boolean }>;
      locale?: "es" | "en";
    };

    const channelTitle = (payload.channelTitle || "Conversación").trim();
    const channelType = payload.channelType || "channel";
    const locale = payload.locale === "en" ? "en" : "es";

    const inputMsgs = Array.isArray(payload.messages) ? payload.messages : [];
    const cleaned = inputMsgs
      .map((m) => ({
        author: sanitize(m.author || "Usuario"),
        text: sanitize(m.text || ""),
        isMine: !!m.isMine,
      }))
      .filter((m) => m.text.length > 0)
      .slice(-MAX_MESSAGES);

    if (cleaned.length === 0) {
      return jsonResponse({ error: "empty_messages", message: "No hay mensajes para resumir." }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const transcript = cleaned
      .map((m) => `${m.isMine ? "(yo) " : ""}${m.author}: ${m.text}`)
      .join("\n");

    const channelKindLabel: Record<string, string> = {
      channel: locale === "en" ? "public channel" : "canal público",
      private: locale === "en" ? "private channel" : "canal privado",
      im: locale === "en" ? "direct message" : "mensaje directo",
      mpim: locale === "en" ? "group DM" : "grupo (MPIM)",
    };

    const systemPrompt = locale === "en"
      ? "You are Kawiil AI, an executive assistant inside the Kawiil OS Slack module. Always respond ONLY with a valid JSON object, no prose, no markdown fences."
      : "Eres Kawiil AI, un asistente ejecutivo dentro del módulo Slack de Kawiil OS. Responde SIEMPRE únicamente con un objeto JSON válido, sin texto adicional ni fences markdown.";

    const userPrompt = locale === "en"
      ? `Summarize the recent activity in this Slack ${channelKindLabel[channelType]} for a busy professional. Be concrete, neutral and brief. DO NOT invent facts.

Channel: ${channelTitle}

Transcript (oldest first):
${transcript}

Return strictly this JSON shape (no other keys, no commentary):
{
  "summary": "2-3 sentence executive summary of what happened recently",
  "pendings": ["max 5 short bullets with open action items, asks waiting on someone, unanswered questions"],
  "decisions": ["max 4 short bullets with explicit decisions/agreements made"],
  "suggestedAction": "one short imperative sentence with the next best action for the user, or null if nothing to do"
}`
      : `Resume la actividad reciente en este ${channelKindLabel[channelType]} de Slack para un profesional ocupado. Sé concreto, neutro y breve. NO inventes datos ni compromisos.

Canal: ${channelTitle}

Transcripción (más antiguo primero):
${transcript}

Devuelve EXACTAMENTE este JSON (sin otras llaves, sin comentarios, sin fences):
{
  "summary": "Resumen ejecutivo de 2-3 oraciones de lo que pasó recientemente",
  "pendings": ["máximo 5 viñetas cortas con pendientes, peticiones en espera y preguntas sin responder"],
  "decisions": ["máximo 4 viñetas cortas con acuerdos/decisiones explícitas tomadas"],
  "suggestedAction": "una sola oración imperativa con la próxima acción recomendada para el usuario, o null si no hay nada que hacer"
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
        max_tokens: 1100,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("slack-ai-summary anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";
    const parsed = tryParseJsonFromText(text);
    if (!parsed) {
      return jsonResponse({ error: "ai_parse_error", raw: text.slice(0, 600) }, 502);
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const toCleanList = (raw: unknown, max = 6): string[] =>
      Array.isArray(raw)
        ? raw
            .map((p) => (typeof p === "string" ? p.trim() : ""))
            .filter((p) => p.length > 0)
            .slice(0, max)
        : [];

    const pendings = toCleanList(parsed.pendings, 6);
    const decisions = toCleanList(parsed.decisions, 5);
    const suggestedAction =
      typeof parsed.suggestedAction === "string" && parsed.suggestedAction.trim().length > 0
        ? parsed.suggestedAction.trim()
        : null;

    return jsonResponse({
      summary,
      pendings,
      decisions,
      suggestedAction,
      model: DEFAULT_MODEL,
    });
  } catch (e) {
    console.error("slack-ai-summary error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
