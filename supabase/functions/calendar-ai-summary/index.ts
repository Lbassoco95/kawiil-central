import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * calendar-ai-summary
 * -------------------
 * Resumen ejecutivo del día/semana del calendario:
 *   - briefing: 2-3 oraciones con la "carga" del periodo
 *   - highlights: hasta 5 viñetas (eventos clave, focos, conflictos)
 *   - conflicts: hasta 4 detecciones (traslapes, jornadas pesadas, sin descanso)
 *   - suggestedAction: una sola próxima acción recomendada (o null)
 *
 * Body:
 *   {
 *     scope: "day" | "week",
 *     periodLabel: string,           // "Hoy lunes 13 de abril" / "Semana del 13 al 19 abr"
 *     events: Array<{
 *       subject: string;
 *       start: string;               // ISO local
 *       end?: string | null;
 *       location?: string | null;
 *       attendeesCount?: number;
 *       isOnline?: boolean;
 *       importance?: "low" | "normal" | "high";
 *       categories?: string[];
 *     }>,
 *     tasksDue?: Array<{
 *       title: string;
 *       due: string;                 // ISO
 *       status?: string;
 *       priority?: string | null;
 *     }>,
 *     locale?: "es" | "en"
 *   }
 *
 * Requiere `verify_jwt = true`. Usa ANTHROPIC_API_KEY.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL =
  Deno.env.get("KAWIIL_AI_FAST_MODEL")?.trim() || "claude-haiku-4-5";

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

type EventIn = {
  subject?: string;
  start?: string;
  end?: string | null;
  location?: string | null;
  attendeesCount?: number;
  isOnline?: boolean;
  importance?: string;
  categories?: string[];
};

type TaskIn = {
  title?: string;
  due?: string;
  status?: string;
  priority?: string | null;
};

function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return iso || "";
  }
}

function eventLine(e: EventIn): string {
  const parts: string[] = [];
  parts.push(`${fmtTime(e.start)}–${fmtTime(e.end)}`.trim() || "(sin hora)");
  parts.push(e.subject || "(sin título)");
  const meta: string[] = [];
  if (typeof e.attendeesCount === "number" && e.attendeesCount > 0) meta.push(`${e.attendeesCount} asistentes`);
  if (e.isOnline) meta.push("online");
  if (e.location) meta.push(e.location);
  if (e.importance && e.importance !== "normal") meta.push(`prioridad ${e.importance}`);
  if (Array.isArray(e.categories) && e.categories.length > 0) meta.push(`cats: ${e.categories.slice(0, 3).join(", ")}`);
  return meta.length > 0 ? `${parts.join(" — ")} (${meta.join("; ")})` : parts.join(" — ");
}

function taskLine(t: TaskIn): string {
  const due = t.due ? new Date(t.due) : null;
  const dueLabel = due && !Number.isNaN(due.getTime())
    ? due.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })
    : "";
  const pieces: string[] = [];
  pieces.push(t.title || "(sin título)");
  if (dueLabel) pieces.push(`vence ${dueLabel}`);
  if (t.priority) pieces.push(`pri ${t.priority}`);
  if (t.status) pieces.push(t.status);
  return `· ${pieces.join(" — ")}`;
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
      scope?: "day" | "week";
      periodLabel?: string;
      events?: EventIn[];
      tasksDue?: TaskIn[];
      locale?: "es" | "en";
    };

    const scope = payload.scope === "week" ? "week" : "day";
    const periodLabel = (payload.periodLabel || (scope === "week" ? "esta semana" : "hoy")).trim();
    const events = Array.isArray(payload.events) ? payload.events.slice(0, 40) : [];
    const tasksDue = Array.isArray(payload.tasksDue) ? payload.tasksDue.slice(0, 30) : [];
    const locale = payload.locale === "en" ? "en" : "es";

    if (events.length === 0 && tasksDue.length === 0) {
      return jsonResponse({
        briefing: locale === "en"
          ? `Your ${scope === "week" ? "week" : "day"} is open: no events or due tasks scheduled.`
          : `Tu ${scope === "week" ? "semana" : "día"} está abierto: no hay eventos ni tareas con vencimiento programadas.`,
        highlights: [],
        conflicts: [],
        suggestedAction: null,
        empty: true,
        model: DEFAULT_MODEL,
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const eventsText = events.length > 0
      ? events.map(eventLine).join("\n")
      : "(sin eventos)";
    const tasksText = tasksDue.length > 0
      ? tasksDue.map(taskLine).join("\n")
      : "(sin tareas con vencimiento)";

    const systemPrompt = locale === "en"
      ? "You are an executive calendar assistant for Kawiil OS. Always respond ONLY with a valid JSON object, no prose, no markdown fences."
      : "Eres un asistente ejecutivo de agenda para Kawiil OS. Responde SIEMPRE únicamente con un objeto JSON válido, sin texto adicional ni fences markdown.";

    const userPrompt = locale === "en"
      ? `Analyze the following ${scope === "week" ? "week" : "day"} (${periodLabel}). Be concrete, neutral and short. Detect realistic conflicts (overlaps, no breaks, very heavy days, back-to-back high importance, location jumps).

Events:
${eventsText}

Tasks due in window:
${tasksText}

Return strictly this JSON shape (no other keys, no commentary):
{
  "briefing": "2-3 sentence executive summary of the period",
  "highlights": ["max 5 short bullets: key meetings, focus blocks, prep needed"],
  "conflicts": ["max 4 short detections of overlaps / heavy load / no breaks; empty array if none"],
  "suggestedAction": "one short imperative sentence with the next best move, or null if nothing"
}`
      : `Analiza este ${scope === "week" ? "intervalo de semana" : "día"} (${periodLabel}). Sé concreto, neutro y breve. NO inventes datos. Detecta conflictos REALES (traslapes, jornadas sin pausa, agenda muy cargada, eventos importantes back-to-back, saltos de ubicación).

Eventos:
${eventsText}

Tareas con vencimiento en la ventana:
${tasksText}

Devuelve EXACTAMENTE este JSON (sin otras llaves, sin comentarios, sin fences):
{
  "briefing": "Resumen ejecutivo de 2-3 oraciones del periodo",
  "highlights": ["máximo 5 viñetas cortas: juntas clave, focos, preparación necesaria"],
  "conflicts": ["máximo 4 detecciones cortas de traslapes / carga / sin pausas; arreglo vacío si no hay"],
  "suggestedAction": "una sola oración imperativa con la próxima acción recomendada, o null si no hay"
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
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("calendar-ai-summary anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";
    const parsed = tryParseJsonFromText(text);
    if (!parsed) {
      return jsonResponse({ error: "ai_parse_error", raw: text.slice(0, 600) }, 502);
    }

    const briefing = typeof parsed.briefing === "string" ? parsed.briefing.trim() : "";
    const highlightsRaw = Array.isArray(parsed.highlights) ? parsed.highlights : [];
    const conflictsRaw = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];
    const highlights = highlightsRaw
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0)
      .slice(0, 6);
    const conflicts = conflictsRaw
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0)
      .slice(0, 5);
    const suggestedAction =
      typeof parsed.suggestedAction === "string" && parsed.suggestedAction.trim().length > 0
        ? parsed.suggestedAction.trim()
        : null;

    return jsonResponse({
      briefing,
      highlights,
      conflicts,
      suggestedAction,
      model: DEFAULT_MODEL,
    });
  } catch (e) {
    console.error("calendar-ai-summary error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
