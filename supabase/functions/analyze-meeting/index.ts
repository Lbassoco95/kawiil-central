import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type PhaseRow = { key: string; name: string };

function slugifyPhaseKey(name: string, used: Set<string>): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "fase";
  let k = `minuta_${base}`;
  let n = 0;
  while (used.has(k)) {
    n += 1;
    k = `minuta_${base}_${n}`;
  }
  used.add(k);
  return k;
}

/**
 * Unifica fases a [{ key, name }], tareas con phase_key; compatible con respuestas antiguas (phases: string[]).
 */
function normalizeMeetingAnalysis(
  parsed: Record<string, unknown>,
  existingPhases: PhaseRow[]
): {
  summary: string;
  phases: PhaseRow[];
  tasks: Record<string, unknown>[];
  import_mode_suggestion: "same_project" | "new_project" | null;
} {
  const usedKeys = new Set<string>(existingPhases.map((p) => p.key));
  const nameToKey = new Map<string, string>();
  for (const p of existingPhases) {
    nameToKey.set(p.name.trim().toLowerCase(), p.key);
  }

  const outPhases: PhaseRow[] = [];
  const knownKeySet = new Set<string>(existingPhases.map((p) => p.key));

  const rawPhases = parsed.phases;
  if (Array.isArray(rawPhases)) {
    for (const item of rawPhases) {
      if (typeof item === "string" && item.trim()) {
        const name = item.trim();
        const lk = name.toLowerCase();
        if (nameToKey.has(lk)) {
          // Fase ya cubierta por el proyecto; no añadir a la lista a fusionar
          continue;
        }
        const key = slugifyPhaseKey(name, usedKeys);
        outPhases.push({ key, name });
        nameToKey.set(lk, key);
        knownKeySet.add(key);
      } else if (item && typeof item === "object" && "key" in item && "name" in item) {
        const o = item as { key: string; name: string };
        if (o.key && o.name) {
          const kn = o.key.trim();
          const nml = o.name.trim().toLowerCase();
          nameToKey.set(nml, kn);
          knownKeySet.add(kn);
          if (!usedKeys.has(kn)) {
            usedKeys.add(kn);
            outPhases.push({ key: kn, name: o.name.trim() });
          }
        }
      }
    }
  }

  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks: Record<string, unknown>[] = [];

  for (const t of rawTasks) {
    if (!t || typeof t !== "object") continue;
    const row = { ...t } as Record<string, unknown>;
    let phaseKey: string | null = null;
    if (typeof row.phase_key === "string" && row.phase_key.trim()) {
      const pk = row.phase_key.trim();
      if (knownKeySet.has(pk)) {
        phaseKey = pk;
      }
    }
    if (!phaseKey && typeof row.phase === "string" && row.phase.trim()) {
      const pl = row.phase.trim().toLowerCase();
      phaseKey = nameToKey.get(pl) ?? null;
      if (!phaseKey) {
        const match = outPhases.find((p) => p.name.trim().toLowerCase() === pl);
        if (match) phaseKey = match.key;
      }
    }
    if (phaseKey) row.phase_key = phaseKey;
    else {
      row.phase_key = null;
    }
    tasks.push(row);
  }

  const mode = parsed.import_mode_suggestion;
  const import_mode_suggestion =
    mode === "new_project" || mode === "same_project"
      ? mode
      : null;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    phases: outPhases,
    tasks,
    import_mode_suggestion,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "ai_not_configured",
          message: "Configura ANTHROPIC_API_KEY en los secretos de Edge Functions (Supabase).",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) throw new Error("Profile not found");

    const body = await req.json();
    const { content, project_id, client_id, area, existing_phases } = body;
    if (!content || !content.trim()) {
      return new Response(JSON.stringify({ error: "No se proporcionó contenido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingPhases: PhaseRow[] = Array.isArray(existing_phases)
      ? (existing_phases as PhaseRow[]).filter(
        (p) => p && typeof p.key === "string" && typeof p.name === "string",
      )
      : [];

    const { data: teamMembers } = await supabase
      .from("profiles")
      .select("user_id, full_name, area")
      .eq("organization_id", profile.organization_id)
      .eq("is_active", true);

    const teamList = (teamMembers || [])
      .map((m) => `- ${m.full_name} (ID: ${m.user_id}, área: ${m.area || "sin área"})`)
      .join("\n");

    const today = new Date().toISOString().split("T")[0];

    const existingPhasesBlock = existingPhases.length
      ? `FASES YA DEFINIDAS EN ESTE PROYECTO (reutiliza su "key" cuando el contenido encaje; no inventes otra key para lo mismo):
${existingPhases.map((p) => `- key: "${p.key}" | nombre: ${p.name}`).join("\n")}`
      : "No hay fases predefinidas en el proyecto: puedes proponer fases nuevas con keys en snake_case (sin espacios).";

    const complianceBlock =
      area === "cumplimiento"
        ? `ÁREA CUMPLIMIENTO — Claves CANÓNICAS (si el tema encaja, USA exactamente una de estas "key" y el nombre asociado; así las tareas caen en el tab correcto):
${CUMPLIMIENTO_STANDARD_KEYS.map((c) => `- "${c.key}" → ${c.name}`).join("\n")}
Si el documento trata de remediación de auditoría externa, observaciones, plan de acción, etc., puedes añadir fases NUEVAS con key única, p. ej. "remediacion_auditoria" o "seguimiento_observaciones" y nombre descriptivo.`
        : "";

    const systemPrompt = `Eres un asistente experto en gestión de proyectos para un despacho contable y legal en México llamado Kawiil.

Tu tarea es ANALIZAR A DETALLE el documento/minuta/reunión y proponer tareas listas para validar y crear en el sistema.

EQUIPO DISPONIBLE:
${teamList}

FECHA ACTUAL: ${today}

${existingPhasesBlock}

${complianceBlock}

INSTRUCCIONES:
1. Analiza el contenido: compromisos, acuerdos, plazos y responsables.
2. Define fases lógicas como objetos { "key", "name" }:
   - "key": identificador estable en snake_case (minúsculas, sin espacios), único. Reutiliza keys de fases existentes o del listado de cumplimiento si aplica.
   - "name": etiqueta legible en español (puede coincidir con títulos de fases del proyecto).
   Incluye en "phases" TODA fase a la que vaya a referirse alguna tarea.
3. Por cada tarea: title, description, priority, due_date, assigned_to_name, assigned_to_id, y "phase_key" (la key de la fase, o null si no aplica a ninguna fase).
4. "import_mode_suggestion": "same_project" si el documento añade trabajo al flujo del proyecto actual; "new_project" si describe un cierre de acciones, plan de remediación o iniciativa MUY desacoplada (p. ej. respuesta a auditoría separada). Solo sugerencia.
5. Incluye todas las tareas y pendientes relevantes.
6. Responde SOLO con JSON válido, sin markdown ni texto adicional.

Estructura EXACTA:
{
  "summary": "2-3 oraciones",
  "import_mode_suggestion": "same_project" | "new_project",
  "phases": [ { "key": "snake_key", "name": "Nombre visible" } ],
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "priority": "urgente" | "alta" | "media" | "baja",
      "due_date": "YYYY-MM-DD" | null,
      "assigned_to_name": "..." | null,
      "assigned_to_id": "uuid" | null,
      "phase_key": "snake_key" | null
    }
  ]
}`;

    const userContent = `Contexto: area del proyecto = ${area || "no especificada"}.

Analiza el documento o minuta y devuelve el JSON:
${content}`;

    let textContent = "";

    try {
      console.log("analyze-meeting: Anthropic Claude…");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: systemPrompt,
          messages: [
            { role: "user", content: userContent },
          ],
          temperature: 0.3,
        }),
      });

      if (response.ok) {
        const aiResponse = await response.json();
        textContent = aiResponse.content?.[0]?.text || "";
      } else {
        const errText = await response.text();
        console.error("Anthropic API error:", response.status, errText.substring(0, 200));
        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Intenta en unos minutos." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (e) {
      console.error("Anthropic request failed:", e instanceof Error ? e.message : e);
    }

    if (!textContent) {
      return new Response(JSON.stringify({ error: "Error al analizar con AI. Intenta de nuevo en unos momentos." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error("Failed to parse AI response:", textContent.substring(0, 500));
      return new Response(JSON.stringify({ error: "Error al interpretar la respuesta de AI", raw: textContent }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalized = normalizeMeetingAnalysis(parsed, existingPhases);

    const allPhaseKeys = new Set<string>([...existingPhases.map((p) => p.key), ...normalized.phases.map((p) => p.key)]);

    const tasks = normalized.tasks.map((t) => {
      let phase_key: string | null = null;
      if (typeof t.phase_key === "string" && t.phase_key.trim() && allPhaseKeys.has(t.phase_key.trim())) {
        phase_key = t.phase_key.trim();
      }
      const tr = t as Record<string, unknown>;
      return {
        title: typeof tr.title === "string" ? tr.title : String(tr.title ?? "").trim() || "Tarea",
        description: tr.description,
        priority: tr.priority,
        due_date: tr.due_date,
        assigned_to_name: tr.assigned_to_name,
        assigned_to_id: tr.assigned_to_id,
        phase: typeof tr.phase === "string" ? tr.phase : null,
        phase_key,
        project_id: project_id || null,
        client_id: client_id || null,
        area: area || null,
      };
    });

    return new Response(
      JSON.stringify({
        summary: normalized.summary,
        import_mode_suggestion: normalized.import_mode_suggestion,
        phases: normalized.phases,
        tasks,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("analyze-meeting error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
