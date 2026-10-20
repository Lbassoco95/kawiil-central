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
 *     documentSummaries: [{ name, summary }], // contenido leído por IA de los documentos
 *     memory: string | null,                  // memoria de la IA del juicio (aclaraciones previas)
 *     conversation: [{ role: "assistant", stages, reply? } | { role: "user", text }]
 *                    // propuestas previas y correcciones del usuario, en orden
 *   }
 *
 * Respuesta: { stages: [{ label, reason }], reply?, memory?, model }
 *   `memory` es la memoria actualizada; solo viene si hubo comentarios del usuario.
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
type TurnIn = { role?: string; text?: string; reply?: string; stages?: { label?: string; reason?: string }[] };

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
      conversation?: TurnIn[];
      memory?: string | null;
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
    const conversation = (payload.conversation ?? []).slice(-12);
    const memory = clip(payload.memory, 3000);
    const hasUserComments = conversation.some((t) => t.role === "user" && clip(t.text, 10));

    const system = `Eres un abogado mexicano que organiza el seguimiento de ${isProcedure ? "trámites legales ante autoridades administrativas" : "juicios"} para un despacho.
Propón la lista de ETAPAS que debe seguir este asunto, en orden cronológico, de acuerdo con su materia, la autoridad y lo que ya consta en la información capturada.
Reglas:
- Entre 4 y 12 etapas, cada una con nombre corto (<= 70 caracteres), en español, sin numeración.
- Usa la vía procesal que corresponda a la materia (penal: denuncia, investigación ante el MP, judicialización, etc.; laboral; mercantil; Profeco/Condusef: queja, conciliación, etc.). No uses etapas civiles genéricas si no aplican.
- Respeta las etapas ya completadas: no las repitas ni las renombres. Propón solo lo que falta y lo que sigue, tomando en cuenta lo que las actuaciones, comentarios y el contenido de los documentos indican que ya ocurrió.
- No inventes hechos, fechas ni números de expediente. Si la información es poca, propón las etapas típicas de la materia.
- La "Memoria del asunto" contiene aclaraciones que el equipo ya te dio en ocasiones anteriores. Tiene prioridad sobre el tipo, la materia y las etapas capturadas.
- El usuario puede comentar o corregir tu propuesta (p. ej. que el asunto es un procedimiento paraprocesal y no una demanda, o que ya pasó cierta etapa). Sus correcciones tienen prioridad sobre todo lo demás (incluida la memoria): rehaz la lista completa conforme a ellas.
Devuelve JSON ESTRICTO, sin texto fuera del JSON ni fences markdown:
{ "stages": [ { "label": string, "reason": string } ], "reply": string, "memory": string }
"reason" es una línea breve que explica por qué esa etapa (o qué dato la sustenta).
"reply" es una o dos frases dirigidas al usuario: qué ajustaste respecto a su comentario (vacío si no hay comentario).
"memory" es la Memoria del asunto actualizada: la memoria previa más lo que el usuario aclaró en esta conversación sobre el asunto (vía procesal, hechos, etapas ya ocurridas, preferencias del despacho). Viñetas "- " breves, en español, máximo ~10 viñetas; si una aclaración nueva contradice una anterior, reemplázala. No incluyas la lista de etapas ni datos que ya están en el expediente. Si el usuario no aclaró nada nuevo, devuelve la memoria previa tal cual (o "" si no había).`;

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

    if (memory) lines.push(`Memoria del asunto (aclaraciones previas del equipo):\n${memory}`);

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

    const messages: { role: "user" | "assistant"; content: string }[] = [
      { role: "user", content: `${lines.join("\n\n")}\n\nDevuelve SOLO el JSON.` },
    ];
    for (const t of conversation) {
      const last = messages[messages.length - 1];
      if (t.role === "assistant" && last.role === "user") {
        const prev = (t.stages ?? [])
          .map((s) => ({ label: clip(s.label, 80), reason: clip(s.reason, 200) }))
          .filter((s) => s.label)
          .slice(0, 14);
        messages.push({ role: "assistant", content: JSON.stringify({ stages: prev, reply: clip(t.reply, 400) }) });
      } else if (t.role === "user" && last.role === "assistant") {
        const text = clip(t.text, 1500);
        if (text) messages.push({ role: "user", content: `Comentario del usuario: ${text}\n\nDevuelve SOLO el JSON.` });
      }
    }
    if (messages[messages.length - 1].role !== "user") messages.pop();

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 1600,
        system,
        messages,
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

    return jsonResponse({
      stages: out,
      reply: clip(parsed?.reply, 400),
      ...(hasUserComments && typeof parsed?.memory === "string" ? { memory: clip(parsed.memory, 3000) } : {}),
      model: DEFAULT_MODEL,
    });
  } catch (e) {
    console.error("lawsuit-ai-stages error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
