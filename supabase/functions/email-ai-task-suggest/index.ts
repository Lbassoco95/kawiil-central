import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
/**
 * email-ai-task-suggest
 * ---------------------
 * Toma un correo y devuelve una sugerencia de tarea con campos prefilled,
 * pensada para el drawer "Crear tarea desde correo".
 *
 * Body:
 *   {
 *     subject: string,
 *     senderName?: string,
 *     senderEmail?: string,
 *     bodyText?: string,        // texto plano del correo
 *     bodyHtml?: string,        // alternativa HTML
 *     aiSummary?: string,       // resumen previo si ya existe
 *     aiSuggestedAction?: string,
 *     receivedAt?: string,      // ISO
 *     locale?: "es" | "en",
 *     userName?: string         // nombre del usuario (para tono)
 *   }
 *
 * Respuesta:
 *   {
 *     suggestion: {
 *       title: string,
 *       description: string,
 *       priority: "baja" | "media" | "alta" | "urgente",
 *       dueHint: string | null,        // "hoy", "mañana", "viernes 25", null
 *       dueDate: string | null,        // YYYY-MM-DD si se puede inferir
 *       reasoning: string              // por qué se sugiere así (1-2 líneas)
 *     },
 *     model: string
 *   }
 *
 * Requiere `verify_jwt = true`. Usa ANTHROPIC_API_KEY.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = Deno.env.get("KAWIIL_AI_FAST_MODEL")?.trim() || "claude-haiku-4-5";

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

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tryParseJsonFromText(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Quita fences markdown
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/m, "")
    .trim();
  // Intento directo
  try { return JSON.parse(cleaned); } catch { /* noop */ }
  // Intento extrayendo el primer objeto JSON
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* noop */ }
  }
  return null;
}

const PRIORITIES = ["baja", "media", "alta", "urgente"] as const;
type Priority = typeof PRIORITIES[number];

function normalizePriority(value: unknown): Priority {
  const s = String(value || "").toLowerCase();
  if ((PRIORITIES as readonly string[]).includes(s)) return s as Priority;
  if (["low"].includes(s)) return "baja";
  if (["medium", "normal"].includes(s)) return "media";
  if (["high"].includes(s)) return "alta";
  if (["urgent", "critical"].includes(s)) return "urgente";
  return "media";
}

/** Convierte un dueHint relativo simple a YYYY-MM-DD usando hoy en TZ MX. */
function dueHintToDate(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const now = new Date();
  const tz = "America/Mexico_City";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  const todayYmd = `${y}-${m}-${d}`;
  const norm = String(hint).toLowerCase().trim();
  // ya viene en YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) return norm;
  if (norm === "hoy" || norm === "today") return todayYmd;
  if (norm === "mañana" || norm === "manana" || norm === "tomorrow") {
    const dt = new Date(`${todayYmd}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  }
  if (norm.startsWith("en ")) {
    const m = norm.match(/^en\s+(\d+)\s+d/);
    if (m) {
      const n = parseInt(m[1], 10);
      const dt = new Date(`${todayYmd}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + n);
      return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    // El gateway ya validó el JWT (verify_jwt=true). Evitar `auth.getUser()`
    // porque cuelga bajo carga con connection reset contra /auth/v1/user.

    const payload = (await req.json().catch(() => ({}))) as {
      subject?: string;
      senderName?: string;
      senderEmail?: string;
      bodyText?: string;
      bodyHtml?: string;
      aiSummary?: string;
      aiSuggestedAction?: string;
      receivedAt?: string;
      locale?: "es" | "en";
      userName?: string;
    };

    const subject = (payload.subject || "").trim();
    const senderName = (payload.senderName || "").trim();
    const senderEmail = (payload.senderEmail || "").trim();
    const bodyText = (payload.bodyText || "").trim() || stripHtml(payload.bodyHtml || "");
    const aiSummary = (payload.aiSummary || "").trim();
    const aiSuggestedAction = (payload.aiSuggestedAction || "").trim();
    const receivedAt = (payload.receivedAt || "").trim();
    const userName = (payload.userName || "").trim();
    const locale = payload.locale === "en" ? "en" : "es";

    if (!subject && !bodyText) {
      return jsonResponse({ error: "empty_email", message: "Falta subject o cuerpo." }, 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const truncatedBody = bodyText.length > 4500 ? bodyText.slice(0, 4500) + "…" : bodyText;

    const systemPrompt = locale === "en"
      ? `You are an executive assistant. Given an email, propose ONE actionable task.
Output STRICT JSON:
{
  "title": string,                 // imperative, <= 90 chars
  "description": string,           // 2-5 lines summarizing what to do and key context
  "priority": "baja"|"media"|"alta"|"urgente",
  "dueHint": "today"|"tomorrow"|"YYYY-MM-DD"|null,
  "reasoning": string              // 1 line, why you chose this priority/due
}
No explanations outside JSON. No markdown fences.`
      : `Eres asistente ejecutivo. A partir de un correo, propón UNA tarea accionable.
Devuelve JSON ESTRICTO:
{
  "title": string,                 // imperativo, <= 90 chars
  "description": string,           // 2-5 líneas: qué hacer y contexto clave
  "priority": "baja"|"media"|"alta"|"urgente",
  "dueHint": "hoy"|"mañana"|"YYYY-MM-DD"|null,
  "reasoning": string              // 1 línea, por qué esa prioridad/fecha
}
Sin texto fuera del JSON. Sin fences markdown.`;

    const ctxLines: string[] = [];
    if (subject) ctxLines.push(locale === "en" ? `Subject: ${subject}` : `Asunto: ${subject}`);
    if (senderName || senderEmail) {
      ctxLines.push(
        locale === "en"
          ? `From: ${senderName} <${senderEmail}>`
          : `De: ${senderName} <${senderEmail}>`,
      );
    }
    if (receivedAt) {
      ctxLines.push(locale === "en" ? `Received: ${receivedAt}` : `Recibido: ${receivedAt}`);
    }
    if (userName) {
      ctxLines.push(
        locale === "en"
          ? `Recipient (you): ${userName}`
          : `Destinatario (tú): ${userName}`,
      );
    }
    if (aiSummary) {
      ctxLines.push(locale === "en" ? `AI summary: ${aiSummary}` : `Resumen IA: ${aiSummary}`);
    }
    if (aiSuggestedAction) {
      ctxLines.push(
        locale === "en"
          ? `AI suggested action: ${aiSuggestedAction}`
          : `Acción sugerida IA: ${aiSuggestedAction}`,
      );
    }

    const userPrompt = locale === "en"
      ? `${ctxLines.join("\n")}

Email body (plain text):
"""
${truncatedBody}
"""

Return ONLY the JSON.`
      : `${ctxLines.join("\n")}

Cuerpo del correo (texto plano):
"""
${truncatedBody}
"""

Devuelve SOLO el JSON.`;

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("email-ai-task-suggest anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    const raw = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";
    const parsed = tryParseJsonFromText(raw);

    if (!parsed || typeof parsed !== "object") {
      return jsonResponse({ error: "empty_suggestion", raw: raw.slice(0, 400) }, 502);
    }

    const title = String(parsed.title || "").trim() || (subject ? `[Correo] ${subject}` : "Tarea desde correo");
    const description = String(parsed.description || "").trim();
    const priority = normalizePriority(parsed.priority);
    const dueHint = parsed.dueHint == null ? null : String(parsed.dueHint).trim() || null;
    const dueDate = dueHintToDate(dueHint);
    const reasoning = String(parsed.reasoning || "").trim();

    return jsonResponse({
      suggestion: {
        title: title.length > 140 ? title.slice(0, 137) + "…" : title,
        description,
        priority,
        dueHint,
        dueDate,
        reasoning,
      },
      model: DEFAULT_MODEL,
    });
  } catch (e) {
    console.error("email-ai-task-suggest error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
