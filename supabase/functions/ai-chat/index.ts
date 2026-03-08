import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const tools = [
  {
    type: "function",
    function: {
      name: "get_my_tasks",
      description: "Obtiene las tareas asignadas al usuario actual. Puede filtrar por estatus, prioridad o área.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"], description: "Filtrar por estatus" },
          priority: { type: "string", enum: ["urgente", "alta", "media", "baja"], description: "Filtrar por prioridad" },
          limit: { type: "number", description: "Máximo de resultados (default 20)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_all_org_tasks",
      description: "Obtiene todas las tareas de la organización (no solo las del usuario). Útil para ver carga de trabajo del equipo.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] },
          area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_clients",
      description: "Busca clientes de la organización por nombre o RFC.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Texto para buscar en nombre o RFC" },
          status: { type: "string", enum: ["activo", "inactivo", "prospecto"] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_projects",
      description: "Obtiene proyectos de la organización. Puede filtrar por estatus o área.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["activo", "pausado", "completado", "cancelado"] },
          area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_reminders",
      description: "Obtiene los recordatorios del usuario actual.",
      parameters: {
        type: "object",
        properties: {
          include_completed: { type: "boolean", description: "Incluir recordatorios completados (default false)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description: "Crea un recordatorio para el usuario actual.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título del recordatorio" },
          description: { type: "string", description: "Descripción opcional" },
          due_date: { type: "string", description: "Fecha de vencimiento en formato YYYY-MM-DD" },
          due_time: { type: "string", description: "Hora opcional en formato HH:MM" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_deadlines",
      description: "Obtiene tareas con fecha de vencimiento próxima (próximos N días) para el usuario o toda la organización.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Número de días hacia adelante (default 7)" },
          only_mine: { type: "boolean", description: "Solo mis tareas (default true)" },
        },
        additionalProperties: false,
      },
    },
  },
];

async function executeTool(
  name: string,
  args: Record<string, any>,
  supabase: any,
  userId: string,
  orgId: string,
) {
  switch (name) {
    case "get_my_tasks": {
      let q = supabase.from("tasks")
        .select("title, status, priority, due_date, area, description, clients(name)")
        .eq("assigned_to", userId);
      if (args.status) q = q.eq("status", args.status);
      else q = q.in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (args.priority) q = q.eq("priority", args.priority);
      q = q.order("due_date", { ascending: true, nullsFirst: false }).limit(args.limit || 20);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_all_org_tasks": {
      let q = supabase.from("tasks")
        .select("title, status, priority, due_date, area, assigned_to")
        .eq("organization_id", orgId);
      if (args.status) q = q.eq("status", args.status);
      else q = q.in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("due_date", { ascending: true, nullsFirst: false }).limit(args.limit || 30);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_clients": {
      let q = supabase.from("clients")
        .select("name, rfc, email, status, services, contact_name, phone")
        .eq("organization_id", orgId);
      if (args.search) q = q.or(`name.ilike.%${args.search}%,rfc.ilike.%${args.search}%`);
      if (args.status) q = q.eq("status", args.status);
      q = q.order("name").limit(args.limit || 15);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_projects": {
      let q = supabase.from("projects")
        .select("name, status, area, start_date, end_date, clients(name)")
        .eq("organization_id", orgId);
      if (args.status) q = q.eq("status", args.status);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("updated_at", { ascending: false }).limit(args.limit || 15);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_my_reminders": {
      let q = supabase.from("reminders")
        .select("title, description, due_date, due_time, is_completed")
        .eq("user_id", userId);
      if (!args.include_completed) q = q.eq("is_completed", false);
      q = q.order("due_date", { ascending: true, nullsFirst: false });
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "create_reminder": {
      const { data, error } = await supabase.from("reminders").insert({
        user_id: userId,
        organization_id: orgId,
        title: args.title,
        description: args.description || null,
        due_date: args.due_date || null,
        due_time: args.due_time || null,
      }).select("id, title, due_date").single();
      return error ? { error: error.message } : { success: true, reminder: data };
    }
    case "get_upcoming_deadlines": {
      const days = args.days || 7;
      const now = new Date();
      const future = new Date(now.getTime() + days * 86400000);
      let q = supabase.from("tasks")
        .select("title, status, priority, due_date, area")
        .eq("organization_id", orgId)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .gte("due_date", now.toISOString().split("T")[0])
        .lte("due_date", future.toISOString().split("T")[0])
        .order("due_date", { ascending: true });
      if (args.only_mine !== false) q = q.eq("assigned_to", userId);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, area, organization_id")
      .eq("user_id", user.id)
      .single();

    const orgId = profile?.organization_id;
    const { messages } = await req.json();

    const systemPrompt = `Eres el asistente inteligente de Kawiil, una plataforma de gestión para despachos contables y legales en México. Tu nombre es Kawiil AI.

Contexto del usuario:
- Nombre: ${profile?.full_name || "Usuario"}
- Célula/Área: ${profile?.area || "No asignada"}
- Fecha actual: ${new Date().toISOString().split("T")[0]}

Tienes acceso a herramientas para consultar datos reales del sistema:
- Puedes ver tareas (propias y del equipo), clientes, proyectos y recordatorios
- Puedes crear recordatorios para el usuario
- Puedes analizar fechas de vencimiento próximas

Tu rol:
1. **Redacción profesional**: Correos, documentos legales/contables. Español formal mexicano.
2. **Gestión de agenda**: Usa las herramientas para revisar tareas y crear recordatorios inteligentes.
3. **Priorización**: Analiza carga de trabajo real y sugiere orden de prioridad.
4. **Consultas operativas**: SAT, IMSS, ISR, IVA, DIOT, etc.
5. **Análisis de equipo**: Distribución de tareas por área o persona.

IMPORTANTE:
- Cuando pregunten sobre tareas, pendientes o agenda, USA las herramientas para datos reales.
- Si sugiere crear un recordatorio, CRÉALO con la herramienta.
- Responde siempre en español con markdown.
- Sé conciso pero completo.`;

    // Tool calling loop (non-streaming)
    let openaiMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const MAX_TOOL_ROUNDS = 5;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: openaiMessages,
          tools,
          stream: false,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Intenta de nuevo." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await response.text();
        console.error("OpenAI error:", status, t);
        return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await response.json();
      const choice = result.choices[0];
      const msg = choice.message;
      openaiMessages.push(msg);

      if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments);
          console.log(`Tool: ${tc.function.name}`, args);
          const toolResult = await executeTool(tc.function.name, args, supabase, user.id, orgId);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }

      // Final response - stream it back as SSE for the frontend
      const finalContent = msg.content || "";
      // Simulate SSE chunks for compatibility with existing frontend
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // Split content into chunks for streaming feel
          const chunkSize = 15;
          for (let i = 0; i < finalContent.length; i += chunkSize) {
            const chunk = finalContent.slice(i, i + chunkSize);
            const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`;
            controller.enqueue(encoder.encode(sseData));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // If we exhausted tool rounds, return error
    return new Response(JSON.stringify({ error: "Demasiadas consultas internas" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
