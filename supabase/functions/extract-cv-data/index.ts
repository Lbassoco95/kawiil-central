// Extrae datos estructurados del CV de un candidato con IA para prellenar su ficha.
//
// Lee el PDF/imagen del CV (bucket privado 'cv', rh_candidates.resume_url) y pide a
// Claude que extraiga los campos de la ficha (universidad, carrera, titulación, años
// de experiencia, pretensión, software, LinkedIn, portafolio, teléfono, correo).
//
// NO escribe en la base: devuelve los datos para que el usuario los revise y confirme
// en la ficha antes de guardar.
//
// Secret requerido: ANTHROPIC_API_KEY
//
// Contrato:
//   POST { candidate_id }
//   200  { ok: true, data: {...} }
//   4xx  { error }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
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

/** Traduce un fallo de la API de Anthropic a un mensaje accionable para el usuario. */
function anthropicErrorMessage(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 200);
  if (status === 401) return "La ANTHROPIC_API_KEY es inválida o falta en Edge Functions (Secrets).";
  if (status === 404) return `El modelo ${MODEL} no está disponible para esta API key.`;
  if (status === 429) return "Límite de uso de la IA alcanzado; espera un momento y reintenta.";
  if (status === 529 || status === 503) return "El servicio de IA está saturado; reintenta en un momento.";
  return `La IA no pudo procesar el CV (Anthropic ${status}). ${snippet}`;
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
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  const { kind, mime } = mediaTypeFor(path);
  return { base64: btoa(binary), mime, kind };
}

const extractTool = {
  name: "save_cv_data",
  description: "Guarda los datos extraídos del CV del candidato para prellenar su ficha.",
  input_schema: {
    type: "object",
    properties: {
      university: { type: ["string", "null"], description: "Universidad / institución de la formación principal." },
      degree: { type: ["string", "null"], description: "Carrera o título académico." },
      education_status: {
        type: ["string", "null"],
        enum: ["titulado", "pasante", "trunco", null],
        description: "Estatus de titulación si se infiere claramente; si no, null.",
      },
      years_experience: { type: ["number", "null"], description: "Años totales de experiencia profesional (número)." },
      salary_expectation: { type: ["number", "null"], description: "Pretensión salarial mensual en pesos, solo si aparece en el CV." },
      available_from: { type: ["string", "null"], description: "Fecha de disponibilidad en formato YYYY-MM-DD, solo si aparece." },
      skills: {
        type: "array",
        items: { type: "string" },
        description: "Software y herramientas que domina (Excel, CONTPAQi, SAT, etc.).",
      },
      linkedin_url: { type: ["string", "null"], description: "URL del perfil de LinkedIn." },
      portfolio_url: { type: ["string", "null"], description: "URL de portafolio / sitio personal." },
      phone: { type: ["string", "null"], description: "Teléfono de contacto." },
      email: { type: ["string", "null"], description: "Correo de contacto." },
    },
    required: ["skills"],
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

    const { data: cand } = await admin
      .from("rh_candidates")
      .select("id, organization_id, full_name, resume_url")
      .eq("id", candidateId)
      .maybeSingle();
    if (!cand) return json({ error: "Candidato no encontrado" }, 404);

    const { data: prof } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!prof || prof.organization_id !== cand.organization_id) {
      return json({ error: "No tienes acceso a este candidato." }, 403);
    }

    if (!cand.resume_url) return json({ error: "El candidato no tiene CV cargado." }, 400);

    const cv = await downloadAsBase64(admin, cand.resume_url);
    if (!cv) return json({ error: "No se pudo leer el CV." }, 502);

    const systemPrompt = `Eres un asistente de reclutamiento. Extrae del CV los datos que sirven para prellenar la ficha del candidato.

REGLAS:
- Extrae SOLO lo que esté en el CV; NO inventes. Si un dato no aparece, usa null (o lista vacía para skills).
- years_experience: estima los años totales de experiencia profesional como número (puede ser decimal).
- education_status: usa "titulado", "pasante" o "trunco" solo si se infiere con claridad; si no, null.
- salary_expectation y available_from: solo si aparecen explícitamente.
- skills: herramientas/software (Excel, CONTPAQi, SAT, ERPs, etc.), no habilidades blandas.
- Responde SIEMPRE usando la herramienta save_cv_data.`;

    const content: unknown[] = [
      cv.kind === "document"
        ? { type: "document", source: { type: "base64", media_type: cv.mime, data: cv.base64 } }
        : { type: "image", source: { type: "base64", media_type: cv.mime, data: cv.base64 } },
      { type: "text", text: `Extrae los datos del CV de ${cand.full_name} con la herramienta save_cv_data.` },
    ];

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content }],
        tools: [extractTool],
        tool_choice: { type: "tool", name: "save_cv_data" },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("Anthropic error:", aiResp.status, errText.substring(0, 500));
      return json({ error: anthropicErrorMessage(aiResp.status, errText) }, 502);
    }

    const aiJson = await aiResp.json();
    const toolUse = (aiJson.content as Array<{ type: string; name?: string; input?: unknown }>)?.find(
      (b) => b.type === "tool_use" && b.name === "save_cv_data",
    );
    if (!toolUse?.input) return json({ error: "El modelo no devolvió datos estructurados." }, 502);

    const r = toolUse.input as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

    const data = {
      university: str(r.university),
      degree: str(r.degree),
      education_status: ["titulado", "pasante", "trunco"].includes(r.education_status as string)
        ? (r.education_status as string)
        : null,
      years_experience: num(r.years_experience),
      salary_expectation: num(r.salary_expectation),
      available_from: str(r.available_from),
      skills: Array.isArray(r.skills) ? (r.skills as unknown[]).map((s) => String(s).trim()).filter(Boolean) : [],
      linkedin_url: str(r.linkedin_url),
      portfolio_url: str(r.portfolio_url),
      phone: str(r.phone),
      email: str(r.email),
    };

    return json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("extract-cv-data error:", message);
    return json({ error: message }, 500);
  }
});
