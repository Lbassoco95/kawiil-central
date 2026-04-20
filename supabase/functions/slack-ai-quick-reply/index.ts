import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * slack-ai-quick-reply
 * --------------------
 * Devuelve 3 sugerencias de respuesta rápida (chips) para insertar en el composer del canal.
 * Pensada para alimentar la zona "Respuesta rápida" del rediseño v2.4 del módulo Slack.
 *
 * Body:
 *   {
 *     channelTitle: string,
 *     channelType?: "channel" | "private" | "im" | "mpim",
 *     messages: Array<{ author: string; text: string; isMine?: boolean }>,
 *     userName?: string,
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
const DEFAULT_MODEL =
  Deno.env.get("KAWIIL_AI_FAST_MODEL")?.trim() || "claude-haiku-4-5";
const MAX_MESSAGES = 30;
const MAX_TEXT_PER_MSG = 500;

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
      messages?: Array<{ author?: string; text?: string; isMine?: boolean }>;
      userName?: string;
      locale?: "es" | "en";
    };

    const channelTitle = (payload.channelTitle || "Conversación").trim();
    const channelType = payload.channelType || "channel";
    const userName = (payload.userName || "").trim();
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
      return jsonResponse({ error: "empty_messages" }, 400);
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
      ? "You generate quick reply suggestions for a Slack-like chat composer. Always respond ONLY with a valid JSON object, no markdown."
      : "Generas sugerencias de respuesta rápida para un composer de chat tipo Slack. Responde SIEMPRE únicamente con un objeto JSON válido, sin markdown.";

    const userPrompt = locale === "en"
      ? `Generate 3 short, ready-to-send Slack reply drafts for the next message in this ${channelKindLabel[channelType]}. Vary tone but keep them all polite and to the point. The user replying is "${userName || "the user"}".

Channel: ${channelTitle}

Recent transcript (oldest first):
${transcript}

Constraints for each "body":
- 1 to 3 short sentences max — Slack style, NOT email
- Plain text, no markdown, no greeting line ("Hi"/"Hello") unless natural
- DO NOT invent facts, dates, names or commitments not present in the transcript
- The reply must respond to the LAST message that is not from the user

Return EXACTLY this JSON shape (no other keys, no commentary):
{
  "suggestions": [
    { "id": "professional", "label": "Respuesta profesional", "tone": "professional", "body": "..." },
    { "id": "short", "label": "Respuesta breve", "tone": "short", "body": "..." },
    { "id": "affirmative", "label": "Confirmar / aceptar", "tone": "affirmative", "body": "..." }
  ]
}`
      : `Genera 3 borradores cortos de respuesta listos para enviar como siguiente mensaje en este ${channelKindLabel[channelType]} de Slack. Varía el tono pero mantén todos cordiales, en español, y al grano. Quien responde es "${userName || "el usuario"}".

Canal: ${channelTitle}

Transcripción reciente (más antiguo primero):
${transcript}

Reglas para cada "body":
- Máximo 1 a 3 oraciones cortas — estilo Slack, NO correo
- Texto plano, sin markdown, sin saludo "Hola/Hi" salvo que sea natural
- NO inventes hechos, fechas, nombres ni compromisos que no estén en la transcripción
- La respuesta debe contestar al ÚLTIMO mensaje que NO sea del usuario

Devuelve EXACTAMENTE este JSON (sin otras llaves, sin comentarios, sin fences):
{
  "suggestions": [
    { "id": "professional", "label": "Respuesta profesional", "tone": "professional", "body": "..." },
    { "id": "short", "label": "Respuesta breve", "tone": "short", "body": "..." },
    { "id": "affirmative", "label": "Confirmar / aceptar", "tone": "affirmative", "body": "..." }
  ]
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
      console.error("slack-ai-quick-reply anthropic error", aiResp.status, txt.slice(0, 400));
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

    return jsonResponse({ suggestions, model: DEFAULT_MODEL });
  } catch (e) {
    console.error("slack-ai-quick-reply error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
