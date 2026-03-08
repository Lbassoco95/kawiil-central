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
      let q = supabase
        .from("tasks")
        .select("title, status, priority, due_date, area, description, created_at, client_id, clients(name)")
        .eq("assigned_to", userId);
      if (args.status) q = q.eq("status", args.status);
      else q = q.in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (args.priority) q = q.eq("priority", args.priority);
      q = q.order("due_date", { ascending: true, nullsFirst: false }).limit(args.limit || 20);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }
    case "get_all_org_tasks": {
      let q = supabase
        .from("tasks")
        .select("title, status, priority, due_date, area, assigned_to, profiles!tasks_assigned_to_fkey(full_name), clients(name)")
        .eq("organization_id", orgId);
      if (args.status) q = q.eq("status", args.status);
      else q = q.in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("due_date", { ascending: true, nullsFirst: false }).limit(args.limit || 30);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }
    case "get_clients": {
      let q = supabase
        .from("clients")
        .select("name, rfc, email, status, services, contact_name, phone")
        .eq("organization_id", orgId);
      if (args.search) q = q.or(`name.ilike.%${args.search}%,rfc.ilike.%${args.search}%`);
      if (args.status) q = q.eq("status", args.status);
      q = q.order("name").limit(args.limit || 15);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }
    case "get_projects": {
      let q = supabase
        .from("projects")
        .select("name, status, area, start_date, end_date, clients(name)")
        .eq("organization_id", orgId);
      if (args.status) q = q.eq("status", args.status);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("updated_at", { ascending: false }).limit(args.limit || 15);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }
    case "get_my_reminders": {
      let q = supabase
        .from("reminders")
        .select("title, description, due_date, due_time, is_completed")
        .eq("user_id", userId);
      if (!args.include_completed) q = q.eq("is_completed", false);
      q = q.order("due_date", { ascending: true, nullsFirst: false });
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
    }
    case "create_reminder": {
      const { data, error } = await supabase.from("reminders").insert({
        user_id: userId,
        organization_id: orgId,
        title: args.title,
        description: args.description || null,
        due_date: args.due_date || null,
        due_time: args.due_time || null,
      }).select().single();
      if (error) return { error: error.message };
      return { success: true, reminder: data };
    }
    case "get_upcoming_deadlines": {
      const days = args.days || 7;
      const now = new Date();
      const future = new Date(now.getTime() + days * 86400000);
      let q = supabase
        .from("tasks")
        .select("title, status, priority, due_date, area, assigned_to, profiles!tasks_assigned_to_fkey(full_name)")
        .eq("organization_id", orgId)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .gte("due_date", now.toISOString().split("T")[0])
        .lte("due_date", future.toISOString().split("T")[0])
        .order("due_date", { ascending: true });
      if (args.only_mine !== false) q = q.eq("assigned_to", userId);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return data;
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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth client to verify user
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader! } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role client for tool execution (bypasses RLS for org-wide queries)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await supabaseAuth
      .from("profiles")
      .select("full_name, area, organization_id")
      .eq("user_id", user.id)
      .single();

    const orgId = profile?.organization_id;
    const { messages, conversationId } = await req.json();

    const systemPrompt = `Eres el asistente inteligente de Kawiil, una plataforma de gestión para despachos contables y legales en México. Tu nombre es Kawiil AI.

Contexto del usuario:
- Nombre: ${profile?.full_name || "Usuario"}
- Célula/Área: ${profile?.area || "No asignada"}

Tienes acceso a herramientas para consultar datos reales del sistema:
- Puedes ver tareas (propias y del equipo), clientes, proyectos y recordatorios
- Puedes crear recordatorios para el usuario
- Puedes analizar fechas de vencimiento próximas

Tu rol:
1. **Redacción profesional**: Correos, documentos legales/contables, respuestas a clientes. Español formal mexicano.
2. **Gestión de agenda**: Usa las herramientas para revisar tareas pendientes y crear recordatorios inteligentes.
3. **Priorización**: Analiza carga de trabajo real y sugiere orden de prioridad.
4. **Consultas operativas**: Procesos contables, fiscales y legales mexicanos (SAT, IMSS, ISR, IVA, DIOT, etc.).
5. **Análisis de equipo**: Revisa la distribución de tareas por área o persona.

IMPORTANTE:
- Cuando el usuario pregunte sobre sus tareas o pendientes, USA las herramientas para obtener datos reales.
- Cuando sugiera crear un recordatorio, CREA EL RECORDATORIO con la herramienta.
- Responde siempre en español con markdown.
- Sé conciso pero completo.`;

    // Non-streaming loop with tool calling
    let openaiMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const MAX_TOOL_ROUNDS = 5;
    let finalContent = "";

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
        console.error("OpenAI error:", response.status, t);
        return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await response.json();
      const choice = result.choices[0];
      const msg = choice.message;

      // Add assistant message to history
      openaiMessages.push(msg);

      if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
        // Execute all tool calls
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments);
          console.log(`Tool call: ${tc.function.name}`, args);
          const toolResult = await executeTool(tc.function.name, args, supabaseAuth, user.id, orgId);
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }
        // Continue the loop for the next round
        continue;
      }

      // No more tool calls - we have the final response
      finalContent = msg.content || "";
      break;
    }

    // Now do a final streaming call with the complete context for nice UX
    const streamResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          ...openaiMessages.slice(0, -1), // Remove last assistant message
          // Ask it to re-generate the final response as a stream
          { role: "user", content: `Responde basándote en la información que obtuviste. Tu respuesta anterior fue: "${finalContent}". Reformula y presenta de forma clara.` },
        ],
        stream: true,
      }),
    });

    if (!streamResponse.ok) {
      // Fallback: return the non-streamed content as SSE
      const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sseData, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    return new Response(streamResponse.body, {
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
