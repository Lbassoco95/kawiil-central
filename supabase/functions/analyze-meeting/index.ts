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
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

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
4. Responde EXCLUSIVAMENTE con el JSON solicitado, sin texto adicional.

RESPONDE con un JSON válido con esta estructura exacta:
{
  "summary": "Resumen breve de la reunión en 2-3 oraciones",
  "tasks": [
    {
      "title": "Título de la tarea",
      "description": "Descripción breve",
      "priority": "media",
      "due_date": "YYYY-MM-DD",
      "assigned_to_name": "Nombre de la persona o null",
      "assigned_to_id": "UUID del usuario o null"
    }
  ]
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Analiza el siguiente documento/minuta y extrae las tareas:\n\n${content}`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de solicitudes excedido. Intenta de nuevo en unos minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Error al analizar con AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const textContent = aiResponse.content?.[0]?.text || "";

    // Extract JSON from the response
    let parsed;
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      console.error("Failed to parse AI response:", textContent);
      return new Response(JSON.stringify({ error: "Error al interpretar la respuesta de AI", raw: textContent }), {
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
