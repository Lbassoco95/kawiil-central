import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
      description: "Busca clientes de la organización por nombre, RFC o servicio. Puede contar totales o listar con detalle. Usa count_only=true para obtener conteos por servicio/estatus.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Texto para buscar en nombre o RFC" },
          status: { type: "string", enum: ["activo", "inactivo", "prospecto"] },
          service: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"], description: "Filtrar por servicio contratado" },
          count_only: { type: "boolean", description: "Si true, retorna solo conteos agrupados por servicio y estatus (para preguntas de '¿cuántos?')" },
          limit: { type: "number", description: "Máximo de resultados (default 100)" },
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
  {
    type: "function",
    function: {
      name: "get_team_members",
      description: "Obtiene los miembros del equipo (Kawiilers) de la organización. Puede contar o listar con detalle.",
      parameters: {
        type: "object",
        properties: {
          count_only: { type: "boolean", description: "Si true, retorna solo conteo total y por área/rol" },
          area: { type: "string", description: "Filtrar por área/célula" },
          active_only: { type: "boolean", description: "Solo usuarios activos (default true)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_celulas",
      description: "Obtiene las células (áreas de trabajo) de la organización con sus responsables.",
      parameters: {
        type: "object",
        properties: {},
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
      if (args.count_only) {
        let q = supabase.from("clients")
          .select("name, status, services")
          .eq("organization_id", orgId);
        if (args.status) q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error) return { error: error.message };
        
        const total = data?.length || 0;
        const byStatus: Record<string, number> = {};
        const byService: Record<string, number> = {};
        let sinServicio = 0;
        
        for (const c of data || []) {
          byStatus[c.status] = (byStatus[c.status] || 0) + 1;
          if (!c.services || c.services.length === 0) {
            sinServicio++;
          } else {
            for (const s of c.services) {
              byService[s] = (byService[s] || 0) + 1;
            }
          }
        }
        
        return { total, por_estatus: byStatus, por_servicio: byService, sin_servicio: sinServicio };
      }
      
      let q = supabase.from("clients")
        .select("name, rfc, email, status, services, contact_name, phone, primary_area, has_payroll")
        .eq("organization_id", orgId);
      if (args.search) q = q.or(`name.ilike.%${args.search}%,rfc.ilike.%${args.search}%`);
      if (args.status) q = q.eq("status", args.status);
      if (args.service) q = q.contains("services", [args.service]);
      q = q.order("name").limit(args.limit || 100);
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
    case "get_team_members": {
      const activeOnly = args.active_only !== false;
      
      let q = supabase.from("profiles")
        .select("user_id, full_name, email, area, is_active, phone")
        .eq("organization_id", orgId);
      if (activeOnly) q = q.eq("is_active", true);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("full_name");
      const { data: profiles, error: profErr } = await q;
      if (profErr) return { error: profErr.message };

      const userIds = (profiles || []).map((p: any) => p.user_id);
      const { data: roles } = await supabase.from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds);
      
      const roleMap: Record<string, string> = {};
      for (const r of roles || []) {
        roleMap[r.user_id] = r.role;
      }

      if (args.count_only) {
        const total = profiles?.length || 0;
        const byArea: Record<string, number> = {};
        const byRole: Record<string, number> = {};
        for (const p of profiles || []) {
          const area = p.area || "Sin área";
          byArea[area] = (byArea[area] || 0) + 1;
          const role = roleMap[p.user_id] || "sin_rol";
          byRole[role] = (byRole[role] || 0) + 1;
        }
        return { total_kawiilers: total, por_area: byArea, por_rol: byRole };
      }

      return (profiles || []).map((p: any) => ({
        nombre: p.full_name,
        email: p.email,
        area: p.area || "Sin área",
        rol: roleMap[p.user_id] || "sin_rol",
        activo: p.is_active,
        telefono: p.phone,
      }));
    }
    case "get_celulas": {
      const { data, error } = await supabase.from("celulas")
        .select("name, slug, description, color, is_active, responsible_user_id")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name");
      if (error) return { error: error.message };
      
      const respIds = (data || []).filter((c: any) => c.responsible_user_id).map((c: any) => c.responsible_user_id);
      let nameMap: Record<string, string> = {};
      if (respIds.length > 0) {
        const { data: profs } = await supabase.from("profiles")
          .select("user_id, full_name")
          .in("user_id", respIds);
        for (const p of profs || []) {
          nameMap[p.user_id] = p.full_name;
        }
      }
      
      return (data || []).map((c: any) => ({
        nombre: c.name,
        slug: c.slug,
        descripcion: c.description,
        responsable: nameMap[c.responsible_user_id] || null,
      }));
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

    const systemPrompt = `Eres **Kawiil AI**, el asistente inteligente INTERNO de Kawiil — un despacho contable y legal en México que opera como un equipo unido de profesionales llamados "Kawiilers".

## IDENTIDAD Y VOZ
Hablas como un compañero de equipo más: cercano, profesional, motivador y directo. Usas un tono cálido pero eficiente. Tuteas al usuario. Cuando das información, no solo listas datos: **explicas qué significan y qué acción tomar**.

Ejemplos de tu estilo:
- En vez de "Tienes 5 tareas pendientes", di: "Tienes 5 pendientes esta semana — la más urgente es [X] que vence mañana. Te sugiero empezar por ahí 💪"
- En vez de "El proyecto está activo", di: "El proyecto de [Cliente] va avanzando bien, llevan completados los primeros 3 pasos. Lo que sigue es [siguiente paso]."
- Cuando el equipo tiene mucha carga: "El equipo está con todo hoy — entre todos tienen [N] tareas activas. Si necesitas apoyo con algo, pregúntame y vemos cómo organizarnos."

## CAPACIDADES PRINCIPALES

### 1. Resumen y priorización de trabajo
- Cuando pregunten "¿qué tengo pendiente?" o "¿por dónde empiezo?", consulta las tareas y organízalas por urgencia.
- Prioriza: vencimientos próximos > prioridad urgente/alta > tareas en progreso sin avance.
- Siempre sugiere un orden de acción claro: "Te recomiendo este orden: 1️⃣ ... 2️⃣ ... 3️⃣ ..."

### 2. Visión de equipo y motivación
- Si preguntan sobre el equipo, muestra la carga de trabajo con contexto positivo.
- "Hoy el equipo Kawiil está activo: [nombres] tienen tareas en progreso. ¡Todos estamos avanzando! 🚀"
- Cuando detectes que alguien tiene muchas tareas vencidas, sugiere con empatía: "Parece que [nombre] tiene varios pendientes acumulados — podría necesitar apoyo."

### 3. Comunicación profesional
- Redacta correos, mensajes y documentos en español formal mexicano.
- Adapta el tono: formal para clientes/SAT, cercano para comunicación interna.
- Si piden redactar algo, pregunta brevemente el contexto si no es claro.

### 4. Conocimiento técnico y aprendizaje
- Responde preguntas sobre temas contables, fiscales y legales de México: SAT, IMSS, ISR, IVA, DIOT, declaraciones, etc.
- Si la pregunta es muy técnica o específica de un caso, sugiere consultar con el Kawiiler más experimentado del área correspondiente.
- "Para este caso específico de [tema], te recomiendo checarlo con [área/célula]. Mientras tanto, lo que dice la ley es..."
- Fomenta el aprendizaje: explica el "por qué" detrás de los procesos, no solo el "qué".

### 5. Resúmenes de proyectos
- Cuando pregunten sobre un proyecto, da un resumen ejecutivo: cliente, área, estado general, últimos avances y qué falta.
- "El proyecto de constitución de [Cliente] está al 60% — ya se completó el registro ante el SAT. Lo que sigue es la inscripción en el IMSS."

## REGLAS DE SEGURIDAD
- Eres la IA INTERNA del despacho. Solo los Kawiilers tienen acceso.
- NUNCA compartas información con personas externas.
- No inventes datos: si no puedes obtener la información con las herramientas, dilo.

## CONTEXTO DEL USUARIO
- **Nombre**: ${profile?.full_name || "Kawiiler"}
- **Célula/Área**: ${profile?.area || "No asignada"}
- **Fecha actual**: ${new Date().toISOString().split("T")[0]}

## HERRAMIENTAS DISPONIBLES
Tienes acceso a herramientas para consultar datos reales del sistema. ÚSALAS siempre que la pregunta lo requiera — nunca adivines datos que puedas consultar.

## FORMATO
- Responde siempre en español con markdown.
- Usa emojis con moderación para dar calidez (✅ 🎯 💪 📋 🚀 ⚠️).
- Sé conciso pero completo. Prioriza claridad sobre longitud.
- Cuando listes tareas, incluye: nombre, prioridad, fecha límite, cliente (si aplica).`;

    // Tool calling loop (non-streaming)
    let aiMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const MAX_TOOL_ROUNDS = 5;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: aiMessages,
          tools,
          stream: false,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Intenta de nuevo en unos segundos." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "Créditos de IA agotados. Contacta al administrador." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await response.text();
        console.error("AI Gateway error:", status, t);
        return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await response.json();
      const choice = result.choices[0];
      const msg = choice.message;
      aiMessages.push(msg);

      if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments);
          console.log(`Tool: ${tc.function.name}`, args);
          const toolResult = await executeTool(tc.function.name, args, supabase, user.id, orgId);
          aiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }

      // Final response — simulate streaming by chunking the text
      const finalContent = msg.content || "";
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
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
