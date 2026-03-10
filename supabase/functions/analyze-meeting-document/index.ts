import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
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

    const body = await req.json();
    const { content, file_base64, filename, project_id, client_id, area } = body;

    const hasText = content && typeof content === "string" && (content as string).trim();

    if (!file_base64 && !hasText) {
      return new Response(JSON.stringify({ error: "Envía contenido de texto o un archivo" }), {
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
2. Para cada tarea que identifiques, propón:
   - title: Nombre claro de la tarea, listo para usarse como título en el proyecto (concreto y accionable).
   - description: Descripción breve con contexto para quien ejecute la tarea.
   - priority: "urgente", "alta", "media" o "baja" según el documento y el impacto.
   - due_date: Fecha de vencimiento propuesta en YYYY-MM-DD (usa las fechas indicadas en el documento o estima una razonable).
   - assigned_to_name y assigned_to_id: Si en el documento se menciona a alguien del equipo por nombre, asigna su user_id de la lista; si no, null.
3. Incluye TODAS las tareas, compromisos y pendientes que encuentres.
4. Responde EXCLUSIVAMENTE con el JSON solicitado, sin texto adicional antes ni después.

RESPONDE con un JSON válido con esta estructura exacta:
{
  "summary": "Resumen breve de la reunión o documento en 2-3 oraciones",
  "tasks": [
    {
      "title": "Nombre claro de la tarea",
      "description": "Descripción breve con contexto",
      "priority": "media",
      "due_date": "YYYY-MM-DD",
      "assigned_to_name": "Nombre de la persona o null",
      "assigned_to_id": "UUID del usuario o null"
    }
  ]
}`;

    // Build messages - for PDFs, use inline_data with Gemini's multimodal support
    const messages: any[] = [
      { role: "system", content: systemPrompt },
    ];

    if (file_base64) {
      // Gemini supports multimodal via OpenAI-compatible format
      const isPdf = (filename || "").toLowerCase().endsWith(".pdf");
      const mimeType = isPdf ? "application/pdf" : "text/plain";
      
      messages.push({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${file_base64}`,
            },
          },
          {
            type: "text",
            text: "Analiza este documento/minuta y extrae las tareas. Responde EXCLUSIVAMENTE con el JSON indicado en las instrucciones del sistema (summary y tasks).",
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: `Analiza el siguiente documento/minuta y extrae las tareas:\n\n${(content as string).trim()}`,
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI Gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "Error al analizar con AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await response.json();
    const textContent = aiResponse.choices?.[0]?.message?.content || "";

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

    const tasks = (parsed.tasks || []).map((t: any) => ({
      ...t,
      project_id: project_id || null,
      client_id: client_id || null,
      area: area || null,
    }));

    const result: { text?: string; summary: string; tasks: any[] } = {
      summary: parsed.summary,
      tasks,
    };
    if (hasText) result.text = (content as string).trim();

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-meeting-document error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
