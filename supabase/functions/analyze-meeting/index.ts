import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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

    // Fetch team members for assignee matching
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

Tu tarea es analizar minutas, documentos o resúmenes de reuniones y extraer tareas accionables.

EQUIPO DISPONIBLE:
${teamList}

FECHA ACTUAL: ${today}

INSTRUCCIONES:
1. Lee cuidadosamente el contenido del documento/minuta/reunión.
2. Identifica TODAS las tareas, compromisos, acuerdos y pendientes mencionados.
3. Para cada tarea, determina:
   - Un título claro y conciso
   - Una descripción breve con contexto
   - Prioridad: "urgente", "alta", "media" o "baja"
   - Fecha de vencimiento tentativa (basada en lo mencionado o estimando razonablemente)
   - Si se menciona a una persona del equipo por nombre, asigna su user_id
4. Usa la herramienta extract_tasks para devolver los resultados.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Analiza el siguiente documento/minuta y extrae las tareas:\n\n${content}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_tasks",
              description: "Extrae el resumen y las tareas identificadas del documento.",
              parameters: {
                type: "object",
                properties: {
                  summary: {
                    type: "string",
                    description: "Resumen breve de la reunión/documento en 2-3 oraciones",
                  },
                  tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string", description: "Título claro y conciso de la tarea" },
                        description: { type: "string", description: "Descripción breve con contexto" },
                        priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
                        due_date: { type: "string", description: "Fecha en formato YYYY-MM-DD o null" },
                        assigned_to_name: { type: "string", description: "Nombre de la persona asignada o null" },
                        assigned_to_id: { type: "string", description: "UUID del usuario asignado o null" },
                      },
                      required: ["title", "description", "priority"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["summary", "tasks"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_tasks" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de solicitudes excedido. Intenta de nuevo en unos minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes para AI. Contacta al administrador." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Error al analizar con AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    
    // Extract from tool call response
    let parsed;
    try {
      const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        parsed = typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
      } else {
        // Fallback: try to parse from content
        const textContent = aiResponse.choices?.[0]?.message?.content || "";
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No structured output found");
        }
      }
    } catch (e) {
      console.error("Failed to parse AI response:", JSON.stringify(aiResponse));
      return new Response(JSON.stringify({ error: "Error al interpretar la respuesta de AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enrich tasks with project/client context
    const tasks = (parsed.tasks || []).map((t: any) => ({
      ...t,
      project_id: project_id || null,
      client_id: client_id || null,
      area: area || null,
    }));

    return new Response(JSON.stringify({ summary: parsed.summary, tasks }), {
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
