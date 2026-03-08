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
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, conversationId } = await req.json();

    // Get user profile for context
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, area")
      .eq("user_id", user.id)
      .single();

    // Get user's pending tasks for context
    const { data: userTasks } = await supabase
      .from("tasks")
      .select("title, status, priority, due_date, area")
      .eq("assigned_to", user.id)
      .in("status", ["pendiente", "en_progreso", "en_revision"])
      .order("due_date", { ascending: true })
      .limit(15);

    // Get recent projects for context
    const { data: recentProjects } = await supabase
      .from("projects")
      .select("name, status, area")
      .eq("status", "activo")
      .limit(10);

    const tasksContext = userTasks?.length
      ? `\n\nTareas pendientes del usuario:\n${userTasks.map((t) => `- ${t.title} (${t.priority}, ${t.status}${t.due_date ? `, vence: ${t.due_date}` : ""})`).join("\n")}`
      : "";

    const projectsContext = recentProjects?.length
      ? `\n\nProyectos activos:\n${recentProjects.map((p) => `- ${p.name} (${p.area || "sin área"})`).join("\n")}`
      : "";

    const systemPrompt = `Eres el asistente inteligente de Kawiil, una plataforma de gestión para despachos contables y legales en México. Tu nombre es Kawiil AI.

Contexto del usuario:
- Nombre: ${profile?.full_name || "Usuario"}
- Célula/Área: ${profile?.area || "No asignada"}
${tasksContext}
${projectsContext}

Tu rol es ayudar al equipo con:
1. **Redacción profesional**: Correos, documentos legales/contables, respuestas a clientes. Siempre en español formal mexicano.
2. **Priorización de tareas**: Analizar la carga de trabajo y sugerir orden de prioridad basado en fechas y urgencia.
3. **Consultas operativas**: Responder sobre procesos contables, fiscales y legales mexicanos (SAT, IMSS, ISR, IVA, DIOT, etc.).
4. **Estructura y razonamiento**: Ayudar a estructurar ideas, argumentos y documentos de forma clara y profesional.
5. **Resolución de dudas**: Si no conoces algo, indícalo honestamente y sugiere dónde encontrar la información.

Formato:
- Responde siempre en español
- Usa markdown para estructurar respuestas (listas, negritas, encabezados)
- Sé conciso pero completo
- Para correos, incluye asunto sugerido
- Para documentos, incluye estructura recomendada`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Intenta de nuevo en unos segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Contacta al administrador." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
