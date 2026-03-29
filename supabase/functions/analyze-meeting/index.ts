import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!LOVABLE_API_KEY && !ANTHROPIC_API_KEY) throw new Error("No AI provider configured");

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

    const { content, project_id, client_id, area } = await req.json();
    if (!content || !content.trim()) {
      return new Response(JSON.stringify({ error: "No se proporcionó contenido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: teamMembers } = await supabase
      .from("profiles")
      .select("user_id, full_name, area")
      .eq("organization_id", profile.organization_id)
      .eq("is_active", true);

    const teamList = (teamMembers || [])
      .map((m) => `- ${m.full_name} (ID: ${m.user_id}, área: ${m.area || "sin área"})`)
      .join("\n");

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `Eres un asistente experto en gestión de proyectos para un despacho contable y legal en México llamado Kawiil.

Tu tarea es ANALIZAR A DETALLE el documento/minuta/reunión y proponer tareas listas para validar y crear directamente en el proyecto.

EQUIPO DISPONIBLE:
${teamList}

FECHA ACTUAL: ${today}

INSTRUCCIONES:
1. Analiza a fondo todo el contenido: compromisos, acuerdos, plazos y responsables mencionados.
2. Identifica FASES o ETAPAS lógicas que agrupen las tareas (por ejemplo: "Preparación documental", "Revisión fiscal", "Presentación ante SAT", etc.). Las fases deben representar bloques de trabajo secuenciales o temáticos.
3. Para cada tarea que identifiques, propón:
   - title: Nombre claro de la tarea, listo para usarse como título en el proyecto (concreto y accionable).
   - description: Descripción breve con contexto para quien ejecute la tarea.
   - priority: "urgente", "alta", "media" o "baja" según el documento y el impacto.
   - due_date: Fecha de vencimiento propuesta en YYYY-MM-DD (usa las fechas indicadas en el documento o estima una razonable).
   - assigned_to_name y assigned_to_id: Si en el documento se menciona a alguien del equipo por nombre, asigna su user_id de la lista; si no, null.
   - phase: Nombre de la fase/etapa a la que pertenece esta tarea (debe coincidir exactamente con uno de los nombres en el array "phases"). Si no aplica, null.
4. Incluye TODAS las tareas, compromisos y pendientes que encuentres.
5. Responde EXCLUSIVAMENTE con el JSON solicitado, sin texto adicional antes ni después.

RESPONDE con un JSON válido con esta estructura exacta:
{
  "summary": "Resumen breve de la reunión o documento en 2-3 oraciones",
  "phases": ["Fase 1", "Fase 2"],
  "tasks": [
    {
      "title": "Nombre claro de la tarea",
      "description": "Descripción breve con contexto",
      "priority": "media",
      "due_date": "YYYY-MM-DD",
      "assigned_to_name": "Nombre de la persona o null",
      "assigned_to_id": "UUID del usuario o null",
      "phase": "Fase 1 o null"
    }
  ]
}`;

    // Try Gemini (Lovable AI) first — handles large contexts well
    let textContent = "";
    let aiError = "";

    if (LOVABLE_API_KEY) {
      try {
        console.log("Using Lovable AI (Gemini) for analysis...");
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Analiza el siguiente documento/minuta y extrae las tareas:\n\n${content}` },
            ],
            temperature: 0.3,
            max_tokens: 8192,
          }),
        });

        if (response.ok) {
          const aiResponse = await response.json();
          textContent = aiResponse.choices?.[0]?.message?.content || "";
        } else {
          const errText = await response.text();
          console.warn("Lovable AI error:", response.status, errText.substring(0, 200));
          if (response.status === 429) {
            aiError = "Demasiadas solicitudes. Intenta en unos minutos.";
          } else if (response.status === 402) {
            aiError = "Créditos de IA agotados.";
          }
        }
      } catch (e) {
        console.warn("Lovable AI request failed:", e instanceof Error ? e.message : e);
      }
    }

    // Fallback to Anthropic if Gemini didn't work
    if (!textContent && ANTHROPIC_API_KEY && !aiError) {
      try {
        console.log("Falling back to Anthropic...");
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
              { role: "user", content: `Analiza el siguiente documento/minuta y extrae las tareas:\n\n${content}` },
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
        }
      } catch (e) {
        console.error("Anthropic request failed:", e instanceof Error ? e.message : e);
      }
    }

    if (aiError) {
      return new Response(JSON.stringify({ error: aiError }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!textContent) {
      return new Response(JSON.stringify({ error: "Error al analizar con AI. Intenta de nuevo en unos momentos." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed;
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
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

    const tasks = (parsed.tasks || []).map((t: any) => ({
      ...t,
      project_id: project_id || null,
      client_id: client_id || null,
      area: area || null,
    }));

    const phases = parsed.phases || [];

    return new Response(JSON.stringify({ summary: parsed.summary, phases, tasks }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-meeting error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
