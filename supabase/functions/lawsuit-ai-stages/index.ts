import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
/**
 * lawsuit-ai-stages
 * -----------------
 * Propone las etapas de un juicio o trámite legal (queja Profeco/Condusef, etc.)
 * a partir de lo que ya se capturó: datos del expediente, notas, actuaciones,
 * comentarios y nombres de los documentos adjuntos.
 *
 * Body:
 *   {
 *     lawsuit: { name, type, typeLabel, isProcedure, caseNumber, court,
 *                plaintiff, defendant, status, filedDate, notes },
 *     stages:    [{ label, completed }],     // etapas actuales
 *     entries:   [{ date, content }],        // actuaciones (más recientes primero)
 *     comments:  [{ date, text }],           // comentarios
 *     documents: string[],                   // nombres de archivos adjuntos
 *     documentSummaries: [{ name, summary }] // contenido leído por IA de los documentos
 *   }
 *
 * Respuesta: { stages: [{ label, reason }], model }
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

const clip = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
};

function tryParseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/m, "").trim();
  try { return JSON.parse(cleaned); } catch { /* noop */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* noop */ }
  }
  return null;
}

type Lawsuit = Record<string, unknown>;
type StageIn = { label?: string; completed?: boolean };
type EntryIn = { date?: string; content?: string };
type CommentIn = { date?: string; text?: string };
type DocSummaryIn = { name?: string; summary?: string };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const payload = (await req.json().catch(() => ({}))) as {
      lawsuit?: Lawsuit;
      stages?: StageIn[];
      entries?: EntryIn[];
      comments?: CommentIn[];
      documents?: string[];
      documentSummaries?: DocSummaryIn[];
    };

    const l = payload.lawsuit ?? {};
    const name = clip(l.name, 200);
    if (!name) return jsonResponse({ error: "empty_lawsuit", message: "Falta el nombre del juicio." }, 400);

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const stages = (payload.stages ?? []).slice(0, 40);
    const entries = (payload.entries ?? []).slice(0, 25);
    const comments = (payload.comments ?? []).slice(0, 25);
    const documents = (payload.documents ?? []).slice(0, 40);
    const docSummaries = (payload.documentSummaries ?? []).slice(0, 15);
    const isProcedure = l.isProcedure === true;

    const system = `Eres un abogado mexicano que organiza el seguimiento de ${isProcedure ? "trámites legales ante autoridades administrativas" : "juicios"} para un despacho.
Propón la lista de ETAPAS que debe seguir este asunto, en orden cronológico, de acuerdo con su materia, la autoridad y lo que ya consta en la información capturada.
Reglas:
- Entre 4 y 12 etapas, cada una con nombre corto (<= 70 caracteres), en español, sin numeración.
- Usa la vía procesal que corresponda a la materia (penal: denuncia, investigación ante el MP, judicialización, etc.; laboral; mercantil; Profeco/Condusef: queja, conciliación, etc.). No uses etapas civiles genéricas si no aplican.
- Respeta las etapas ya completadas: no las repitas ni las renombres. Propón solo lo que falta y lo que sigue, tomando en cuenta lo que las actuaciones, comentarios y el contenido de los documentos indican que ya ocurrió.
- No inventes hechos, fechas ni números de expediente. Si la información es poca, propón las etapas típicas de la materia.
Devuelve JSON ESTRICTO, sin texto fuera del JSON ni fences markdown:
{ "stages": [ { "label": string, "reason": string } ] }
"reason" es una línea breve que explica por qué esa etapa (o qué dato la sustenta).`;

    const lines: string[] = [];
    lines.push(`Nombre: ${name}`);
    if (l.typeLabel || l.type) lines.push(`Tipo / materia: ${clip(l.typeLabel || l.type, 80)}`);
    lines.push(`Clase: ${isProcedure ? "trámite legal (no es juicio)" : "juicio"}`);
    if (l.caseNumber) lines.push(`Expediente / folio: ${clip(l.caseNumber, 80)}`);
    if (l.court) lines.push(`Juzgado / autoridad: ${clip(l.court, 160)}`);
    if (l.plaintiff) lines.push(`${isProcedure ? "Quejoso / promovente" : "Actor"}: ${clip(l.plaintiff, 160)}`);
    if (l.defendant) lines.push(`${isProcedure ? "Proveedor / institución" : "Demandado"}: ${clip(l.defendant, 160)}`);
    if (l.status) lines.push(`Estatus: ${clip(l.status, 60)}`);
    if (l.filedDate) lines.push(`Presentado: ${clip(l.filedDate, 20)}`);
    if (l.notes) lines.push(`Notas:\n${clip(l.notes, 1500)}`);

    if (stages.length) {
      lines.push(
        "Etapas actuales:\n" +
          stages.map((s) => `- [${s.completed ? "x" : " "}] ${clip(s.label, 100)}`).join("\n"),
      );
    }
    if (entries.length) {
      lines.push(
        "Actuaciones registradas (recientes primero):\n" +
          entries.map((e) => `- ${clip(e.date, 12)}: ${clip(e.content, 500)}`).join("\n"),
      );
    }
    if (comments.length) {
      lines.push(
        "Comentarios:\n" + comments.map((c) => `- ${clip(c.date, 12)}: ${clip(c.text, 500)}`).join("\n"),
      );
    }
    if (documents.length) {
      lines.push("Documentos adjuntos (solo nombres):\n" + documents.map((d) => `- ${clip(d, 140)}`).join("\n"));
    }

    if (docSummaries.length) {
      lines.push(
        "Contenido de los documentos del expediente (resumen generado por IA):\n" +
          docSummaries.map((d) => `- ${clip(d.name, 120)}: ${clip(d.summary, 1200)}`).join("\n"),
      );
    }

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 1200,
        system,
        messages: [{ role: "user", content: `${lines.join("\n\n")}\n\nDevuelve SOLO el JSON.` }],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("lawsuit-ai-stages anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    const raw = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";
    const parsed = tryParseJson(raw);
    const list = Array.isArray(parsed?.stages) ? (parsed!.stages as unknown[]) : [];

    const out = list
      .map((s) => {
        const o = (s ?? {}) as { label?: unknown; reason?: unknown };
        return { label: clip(o.label, 80), reason: clip(o.reason, 200) };
      })
      .filter((s) => s.label)
      .slice(0, 14);

    if (out.length === 0) return jsonResponse({ error: "empty_suggestion", raw: raw.slice(0, 400) }, 502);

    return jsonResponse({ stages: out, model: DEFAULT_MODEL });
  } catch (e) {
    console.error("lawsuit-ai-stages error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
