// Análisis de "Fit Kawiil" de un candidato con IA.
//
// Lee el PDF del examen psicométrico (bucket privado 'cv'), lo combina con:
//   - los requisitos de la vacante (rh_recruitment_processes.title/description/grade/area)
//   - el perfil cultural global de Kawiil (organizations.settings->>'rh_cultural_profile')
//   - extractos relevantes de los manuales indexados en la base de conocimiento
//     (document_chunks vía match_document_chunks, si OPENAI_API_KEY está configurada)
// y pide a Claude un análisis estructurado: fit_score (0-100), fortalezas, riesgos,
// preguntas de entrevista y puntajes sugeridos para la rúbrica existente.
//
// Guarda el resultado en rh_candidates (ai_fit_score, ai_analysis, ai_analyzed_at,
// ai_analyzed_by) y registra una actividad en la bitácora del candidato.
//
// Secrets requeridos en Edge Functions:
//   ANTHROPIC_API_KEY  (obligatorio)
//   OPENAI_API_KEY     (opcional — habilita el contexto de manuales por RAG)
//
// Contrato:
//   POST { candidate_id }
//   200  { ok: true, analysis }
//   4xx  { error }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";
const CV_BUCKET = "cv";
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mediaTypeFor(path: string): { kind: "document" | "image"; mime: string } {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return { kind: "image", mime: "image/png" };
  if (ext === "jpg" || ext === "jpeg") return { kind: "image", mime: "image/jpeg" };
  if (ext === "webp") return { kind: "image", mime: "image/webp" };
  return { kind: "document", mime: "application/pdf" };
}

async function downloadAsBase64(
  admin: ReturnType<typeof createClient>,
  path: string,
): Promise<{ base64: string; mime: string; kind: "document" | "image" } | null> {
  const { data, error } = await admin.storage.from(CV_BUCKET).download(path);
  if (error || !data) {
    console.error("storage download error:", error?.message);
    return null;
  }
  const buf = new Uint8Array(await data.arrayBuffer());
  // Codificar en base64 por bloques para no reventar el call stack con archivos grandes.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  const { kind, mime } = mediaTypeFor(path);
  return { base64: btoa(binary), mime, kind };
}

// Recupera extractos de los manuales/base de conocimiento por similitud semántica.
async function retrieveManuals(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  query: string,
): Promise<string> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return "";
  try {
    const embResp = await fetch(OPENAI_EMBED_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
    });
    if (!embResp.ok) return "";
    const embData = await embResp.json();
    const queryEmbedding = embData.data?.[0]?.embedding;
    if (!queryEmbedding) return "";

    const { data: results, error } = await admin.rpc("match_document_chunks", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: 6,
      filter_org_id: orgId,
      filter_client_id: null,
      filter_project_id: null,
      filter_source_types: null,
      similarity_threshold: 0.3,
    });
    if (error || !results?.length) return "";
    return (results as Array<{ content: string }>)
      .map((r, i) => `[Manual ${i + 1}] ${r.content}`)
      .join("\n\n");
  } catch (e) {
    console.error("retrieveManuals error:", e instanceof Error ? e.message : e);
    return "";
  }
}

const fitTool = {
  name: "save_candidate_fit",
  description:
    "Guarda el análisis estructurado de qué tanto se adapta el candidato a Kawiil y al puesto.",
  input_schema: {
    type: "object",
    properties: {
      fit_score: {
        type: "integer",
        description: "Qué tanto encaja el candidato con Kawiil y el puesto, de 0 a 100.",
      },
      summary: {
        type: "string",
        description: "Resumen ejecutivo (2-4 frases) del fit del candidato.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description: "Fortalezas / señales positivas relevantes para Kawiil y el puesto.",
      },
      risks: {
        type: "array",
        items: { type: "string" },
        description: "Banderas, riesgos o áreas a explorar / validar.",
      },
      interview_questions: {
        type: "array",
        items: { type: "string" },
        description: "Preguntas sugeridas para la entrevista que ayudan a validar dudas.",
      },
      suggested_rubric_scores: {
        type: "array",
        description: "Sugerencia de puntaje (1-5) para cada criterio de la rúbrica provista.",
        items: {
          type: "object",
          properties: {
            criterion_id: { type: "string" },
            criterion_name: { type: "string" },
            score: { type: "integer", description: "Puntaje sugerido de 1 a 5." },
            rationale: { type: "string", description: "Justificación breve del puntaje." },
          },
          required: ["criterion_id", "score"],
        },
      },
    },
    required: ["fit_score", "summary", "strengths", "risks", "interview_questions"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "IA no configurada (falta ANTHROPIC_API_KEY)." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json({ error: "No autorizado" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const candidateId = String(body.candidate_id ?? "").trim();
    if (!candidateId) return json({ error: "Falta candidate_id" }, 400);

    // Candidato (desde el servidor; no se confía en el cliente).
    const { data: cand } = await admin
      .from("rh_candidates")
      .select(
        "id, organization_id, process_id, full_name, email, assessment_file_path, resume_url, university, degree, education_status, skills, years_experience, salary_expectation, linkedin_url, portfolio_url, notes",
      )
      .eq("id", candidateId)
      .maybeSingle();
    if (!cand) return json({ error: "Candidato no encontrado" }, 404);

    // El que llama debe pertenecer a la misma organización.
    const { data: prof } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!prof || prof.organization_id !== cand.organization_id) {
      return json({ error: "No tienes acceso a este candidato." }, 403);
    }

    if (!cand.assessment_file_path) {
      return json({ error: "Sube primero el PDF del examen / psicométrico." }, 400);
    }

    // Contexto: vacante, organización (perfil cultural) y criterios de la rúbrica.
    const [{ data: proc }, { data: org }, { data: criteria }] = await Promise.all([
      admin
        .from("rh_recruitment_processes")
        .select("title, description, grade, area")
        .eq("id", cand.process_id)
        .maybeSingle(),
      admin.from("organizations").select("name, settings").eq("id", cand.organization_id).maybeSingle(),
      admin
        .from("rh_recruitment_criteria")
        .select("id, name, weight")
        .eq("process_id", cand.process_id)
        .order("position", { ascending: true }),
    ]);

    const culturalProfile =
      (org?.settings && typeof org.settings === "object"
        ? (org.settings as Record<string, unknown>).rh_cultural_profile
        : null) ?? "";

    // PDF del examen (obligatorio) y CV (opcional) como documentos para Claude.
    const exam = await downloadAsBase64(admin, cand.assessment_file_path);
    if (!exam) return json({ error: "No se pudo leer el PDF del examen." }, 502);
    const cv = cand.resume_url ? await downloadAsBase64(admin, cand.resume_url) : null;

    // Manuales relevantes por RAG (si hay OPENAI_API_KEY).
    const manuals = await retrieveManuals(
      admin,
      cand.organization_id,
      `Cultura, valores y competencias de Kawiil para el puesto ${proc?.title ?? ""}. ${proc?.description ?? ""}`,
    );

    const criteriaList = (criteria ?? []) as Array<{ id: string; name: string; weight: number }>;

    const systemPrompt = `Eres un especialista en reclutamiento y selección para Kawiil. Tu trabajo es evaluar qué tanto un candidato se adapta a Kawiil (cultura y valores) y al puesto específico, a partir de su examen psicométrico y su información.

REGLAS:
- Sé objetivo y prudente; distingue entre evidencia del examen y suposiciones.
- El fit_score (0-100) debe reflejar el ajuste combinado con la cultura de Kawiil y los requisitos del puesto.
- Para suggested_rubric_scores usa EXACTAMENTE los criterion_id provistos en la lista de criterios; asigna 1-5 y una justificación breve. Si no hay criterios, regresa una lista vacía.
- Las preguntas de entrevista deben atacar dudas o banderas concretas que surjan del análisis.
- Responde en español. SIEMPRE usa la herramienta save_candidate_fit para entregar el resultado.`;

    const contextText = `## PUESTO / VACANTE
Título: ${proc?.title ?? "(sin título)"}
Grado: ${proc?.grade ?? "n/d"}
Área: ${proc?.area ?? "n/d"}
Descripción / requisitos:
${proc?.description?.trim() || "(sin descripción registrada)"}

## PERFIL CULTURAL DE KAWIIL
${typeof culturalProfile === "string" && culturalProfile.trim() ? culturalProfile : "(no se ha configurado un perfil cultural; usa principios generales de fit cultural y enfócate en los requisitos del puesto)"}

## EXTRACTOS DE MANUALES / BASE DE CONOCIMIENTO
${manuals || "(sin extractos disponibles)"}

## DATOS DEL CANDIDATO
Nombre: ${cand.full_name}
Formación: ${cand.degree ?? "n/d"} — ${cand.university ?? "n/d"} (${cand.education_status ?? "n/d"})
Años de experiencia: ${cand.years_experience ?? "n/d"}
Software / skills: ${(cand.skills ?? []).join(", ") || "n/d"}
Pretensión ($/mes): ${cand.salary_expectation ?? "n/d"}
Notas: ${cand.notes ?? "n/d"}

## CRITERIOS DE LA RÚBRICA (usa estos criterion_id en suggested_rubric_scores)
${criteriaList.length ? criteriaList.map((c) => `- ${c.name} (peso ${c.weight}) → criterion_id: ${c.id}`).join("\n") : "(la vacante no tiene criterios configurados)"}

Adjunto el PDF del examen / psicométrico${cv ? " y el CV" : ""}. Analiza al candidato y entrega el resultado con la herramienta save_candidate_fit.`;

    const content: unknown[] = [];
    content.push(
      exam.kind === "document"
        ? { type: "document", source: { type: "base64", media_type: exam.mime, data: exam.base64 } }
        : { type: "image", source: { type: "base64", media_type: exam.mime, data: exam.base64 } },
    );
    if (cv) {
      content.push(
        cv.kind === "document"
          ? { type: "document", source: { type: "base64", media_type: cv.mime, data: cv.base64 } }
          : { type: "image", source: { type: "base64", media_type: cv.mime, data: cv.base64 } },
      );
    }
    content.push({ type: "text", text: contextText });

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content }],
        tools: [fitTool],
        tool_choice: { type: "tool", name: "save_candidate_fit" },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("Anthropic error:", aiResp.status, errText.substring(0, 500));
      return json({ error: "El modelo no pudo procesar el examen. Intenta de nuevo." }, 502);
    }

    const aiJson = await aiResp.json();
    const toolUse = (aiJson.content as Array<{ type: string; name?: string; input?: unknown }>)?.find(
      (b) => b.type === "tool_use" && b.name === "save_candidate_fit",
    );
    if (!toolUse?.input) {
      return json({ error: "El modelo no devolvió un análisis estructurado." }, 502);
    }

    const result = toolUse.input as Record<string, unknown>;
    const rawScore = Number(result.fit_score);
    const fitScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : null;

    const analysis = {
      fit_score: fitScore,
      summary: result.summary ?? "",
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      risks: Array.isArray(result.risks) ? result.risks : [],
      interview_questions: Array.isArray(result.interview_questions) ? result.interview_questions : [],
      suggested_rubric_scores: Array.isArray(result.suggested_rubric_scores)
        ? result.suggested_rubric_scores
        : [],
      model: MODEL,
      used_manuals: !!manuals,
      analyzed_at: new Date().toISOString(),
    };

    const { error: updErr } = await admin
      .from("rh_candidates")
      .update({
        ai_fit_score: fitScore,
        ai_analysis: analysis,
        ai_analyzed_at: analysis.analyzed_at,
        ai_analyzed_by: caller.id,
      })
      .eq("id", cand.id);
    if (updErr) console.error("No se pudo guardar el análisis:", updErr.message);

    await admin.from("rh_candidate_activities").insert({
      organization_id: cand.organization_id,
      candidate_id: cand.id,
      activity_type: "note",
      content: `Análisis IA del examen — Fit Kawiil: ${fitScore ?? "n/d"}/100`,
      metadata: { kind: "ai_fit", fit_score: fitScore, model: MODEL },
      created_by: caller.id,
    });

    return json({ ok: true, analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("analyze-candidate-fit error:", message);
    return json({ error: message }, 500);
  }
});
