import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get('SITE_URL') || '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function escapePostgrestString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/,/g, '\\,')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// ─── Anthropic tool definitions ───
const anthropicTools = [
  {
    name: "get_my_tasks",
    description: "Obtiene las tareas asignadas al usuario actual. Puede filtrar por estatus, prioridad o área.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] },
        priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
        limit: { type: "number", description: "Máximo de resultados (default 20)" },
      },
    },
  },
  {
    name: "get_all_org_tasks",
    description: "Obtiene todas las tareas de la organización (no solo las del usuario). Útil para ver carga de trabajo del equipo.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] },
        area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_clients",
    description: "Busca clientes de la organización por nombre, RFC o servicio. Usa count_only=true para obtener conteos.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Texto para buscar en nombre o RFC" },
        status: { type: "string", enum: ["activo", "inactivo", "prospecto"] },
        service: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
        count_only: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_projects",
    description: "Obtiene proyectos de la organización. Puede filtrar por estatus o área.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["activo", "pausado", "completado", "cancelado"] },
        area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_my_reminders",
    description: "Obtiene los recordatorios del usuario actual.",
    input_schema: {
      type: "object",
      properties: {
        include_completed: { type: "boolean" },
      },
    },
  },
  {
    name: "create_reminder",
    description: "Crea un recordatorio para el usuario actual.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        due_time: { type: "string", description: "HH:MM" },
      },
      required: ["title"],
    },
  },
  {
    name: "get_upcoming_deadlines",
    description: "Obtiene tareas con fecha de vencimiento próxima.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Días hacia adelante (default 7)" },
        only_mine: { type: "boolean", description: "Solo mis tareas (default true)" },
      },
    },
  },
  {
    name: "get_team_members",
    description: "Obtiene los miembros del equipo (Kawiilers).",
    input_schema: {
      type: "object",
      properties: {
        count_only: { type: "boolean" },
        area: { type: "string" },
        active_only: { type: "boolean" },
      },
    },
  },
  {
    name: "get_celulas",
    description: "Obtiene las células (áreas de trabajo) con sus responsables.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_hub_procedures",
    description: "Busca en los procedimientos y manuales internos del Hub.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string" },
      },
    },
  },
  {
    name: "get_hub_comunicados",
    description: "Obtiene los comunicados internos más recientes.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  // ─── Deep-context tools ───
  {
    name: "get_task_details",
    description: "Obtiene una tarea específica con su descripción completa, comentarios de equipo y archivos adjuntos.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "UUID de la tarea" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_project_details",
    description: "Obtiene un proyecto específico con descripción, pasos, miembros del equipo y tareas asociadas.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "UUID del proyecto" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "get_recent_activity",
    description: "Obtiene la actividad reciente de la organización desde el log de actividad.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Máximo de entradas (default 20)" },
        entity_type: { type: "string", description: "Filtrar por tipo: client, project, task, document" },
      },
    },
  },
  {
    name: "search_across",
    description: "Búsqueda unificada por texto libre en tareas, clientes y proyectos. Devuelve resultados con tipo, id, nombre y URL.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto de búsqueda" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_extracted_documents",
    description: "Consulta documentos procesados por IA (CFDIs, declaraciones, estados de cuenta). Contiene resúmenes, montos, RFCs y periodos fiscales.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "Filtrar por cliente (UUID)" },
        project_id: { type: "string", description: "Filtrar por proyecto (UUID)" },
        limit: { type: "number", description: "Máximo de resultados (default 10)" },
      },
    },
  },
  {
    name: "search_past_conversations",
    description: "Busca en conversaciones pasadas de toda la organización (no solo del usuario actual). Útil para encontrar discusiones anteriores, decisiones tomadas, y contexto que se haya compartido en otros chats. Respeta la privacidad mencionando que la info viene de otra conversación sin revelar quién la tuvo.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto a buscar en mensajes pasados" },
        limit: { type: "number", description: "Máximo de resultados (default 10)" },
      },
      required: ["query"],
    },
  },
];

// ─── OpenAI-format tools for fallback gateway ───
const openaiTools = anthropicTools.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// ─── Tool executor ───
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
        .select("id, title, status, priority, due_date, area, description, clients(name)")
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
        .select("id, title, status, priority, due_date, area, assigned_to")
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
        const { data, error } = await supabase.from("clients")
          .select("name, status, services")
          .eq("organization_id", orgId);
        if (error) return { error: error.message };
        const total = data?.length || 0;
        const byStatus: Record<string, number> = {};
        const byService: Record<string, number> = {};
        for (const c of data || []) {
          byStatus[c.status] = (byStatus[c.status] || 0) + 1;
          if (c.services?.length) {
            for (const s of c.services) byService[s] = (byService[s] || 0) + 1;
          }
        }
        return { total, por_estatus: byStatus, por_servicio: byService };
      }
      let q = supabase.from("clients")
        .select("id, name, rfc, email, status, services, contact_name, phone, primary_area")
        .eq("organization_id", orgId);
      if (args.search) q = q.or(`name.ilike.%${escapePostgrestString(args.search)}%,rfc.ilike.%${escapePostgrestString(args.search)}%`);
      if (args.status) q = q.eq("status", args.status);
      if (args.service) q = q.contains("services", [args.service]);
      q = q.order("name").limit(args.limit || 100);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_projects": {
      let q = supabase.from("projects")
        .select("id, name, status, area, start_date, end_date, description, clients(name)")
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
        user_id: userId, organization_id: orgId,
        title: args.title, description: args.description || null,
        due_date: args.due_date || null, due_time: args.due_time || null,
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
      const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("user_id", userIds);
      const roleMap: Record<string, string> = {};
      for (const r of roles || []) roleMap[r.user_id] = r.role;
      if (args.count_only) {
        const byArea: Record<string, number> = {};
        const byRole: Record<string, number> = {};
        for (const p of profiles || []) {
          byArea[p.area || "Sin área"] = (byArea[p.area || "Sin área"] || 0) + 1;
          byRole[roleMap[p.user_id] || "sin_rol"] = (byRole[roleMap[p.user_id] || "sin_rol"] || 0) + 1;
        }
        return { total_kawiilers: profiles?.length || 0, por_area: byArea, por_rol: byRole };
      }
      return (profiles || []).map((p: any) => ({
        nombre: p.full_name, email: p.email, area: p.area || "Sin área",
        rol: roleMap[p.user_id] || "sin_rol", activo: p.is_active, telefono: p.phone,
      }));
    }
    case "get_celulas": {
      const { data, error } = await supabase.from("celulas")
        .select("name, slug, description, color, is_active, responsible_user_id")
        .eq("organization_id", orgId).eq("is_active", true).order("name");
      if (error) return { error: error.message };
      const respIds = (data || []).filter((c: any) => c.responsible_user_id).map((c: any) => c.responsible_user_id);
      let nameMap: Record<string, string> = {};
      if (respIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", respIds);
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
      }
      return (data || []).map((c: any) => ({
        nombre: c.name, slug: c.slug, descripcion: c.description,
        responsable: nameMap[c.responsible_user_id] || null,
      }));
    }
    case "get_hub_procedures": {
      let q = supabase.from("internal_procedures")
        .select("title, description, file_path, current_version, updated_at")
        .eq("organization_id", orgId).order("updated_at", { ascending: false });
      if (args.search) q = q.or(`title.ilike.%${escapePostgrestString(args.search)}%,description.ilike.%${escapePostgrestString(args.search)}%`);
      q = q.limit(10);
      const { data, error } = await q;
      if (error) return { error: error.message };
      if (!data || data.length === 0) return { message: "No se encontraron procedimientos." };
      return data.map((p: any) => ({ titulo: p.title, descripcion: p.description, version: p.current_version, actualizado: p.updated_at }));
    }
    case "get_hub_comunicados": {
      const { data, error } = await supabase.from("internal_comunicados")
        .select("title, body, is_pinned, created_at")
        .eq("organization_id", orgId)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(args.limit || 5);
      if (error) return { error: error.message };
      return data;
    }

    // ─── Deep-context tools ───
    case "get_task_details": {
      const { data: task, error: tErr } = await supabase.from("tasks")
        .select("id, title, description, status, priority, due_date, area, created_at, completed_at, time_spent_seconds, criticality_level, delay_category, delay_notes, checklist, tags, clients(name), projects(name)")
        .eq("id", args.task_id).single();
      if (tErr) return { error: tErr.message };

      const { data: comments } = await supabase.from("task_comments")
        .select("content, created_at, user_id")
        .eq("task_id", args.task_id)
        .order("created_at", { ascending: true })
        .limit(30);

      let commentData: any[] = [];
      if (comments?.length) {
        const cUserIds = [...new Set(comments.map((c: any) => c.user_id))];
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", cUserIds);
        const nameMap: Record<string, string> = {};
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
        commentData = comments.map((c: any) => ({
          autor: nameMap[c.user_id] || "Desconocido",
          contenido: c.content,
          fecha: c.created_at,
        }));
      }

      const { data: assignees } = await supabase.from("task_assignees")
        .select("user_id").eq("task_id", args.task_id);
      let assigneeNames: string[] = [];
      if (assignees?.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", assignees.map((a: any) => a.user_id));
        assigneeNames = (profs || []).map((p: any) => p.full_name);
      }

      return { ...task, comentarios: commentData, asignados: assigneeNames };
    }

    case "get_project_details": {
      const { data: project, error: pErr } = await supabase.from("projects")
        .select("id, name, description, status, area, start_date, end_date, criticality_level, delay_category, delay_notes, constitution_details, lawsuit_details, tax_obligations, clients(name, rfc)")
        .eq("id", args.project_id).single();
      if (pErr) return { error: pErr.message };

      const { data: members } = await supabase.from("project_members")
        .select("user_id").eq("project_id", args.project_id);
      let memberNames: string[] = [];
      if (members?.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", members.map((m: any) => m.user_id));
        memberNames = (profs || []).map((p: any) => p.full_name);
      }

      const { data: tasks } = await supabase.from("tasks")
        .select("id, title, status, priority, due_date, assigned_to")
        .eq("project_id", args.project_id)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(30);

      return { ...project, miembros: memberNames, tareas: tasks || [] };
    }

    case "get_recent_activity": {
      let q = supabase.from("activity_log")
        .select("entity_type, entity_id, action, details, created_at, user_id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(args.limit || 20);
      if (args.entity_type) q = q.eq("entity_type", args.entity_type);
      const { data, error } = await q;
      if (error) return { error: error.message };

      const userIds = [...new Set((data || []).filter((a: any) => a.user_id).map((a: any) => a.user_id))];
      let nameMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds);
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
      }

      return (data || []).map((a: any) => ({
        tipo: a.entity_type, accion: a.action, fecha: a.created_at,
        usuario: nameMap[a.user_id] || "Sistema", detalles: a.details,
      }));
    }

    case "search_across": {
      const q = args.query;
      const results: any[] = [];

      const { data: tasks } = await supabase.from("tasks")
        .select("id, title, status, area")
        .eq("organization_id", orgId)
        .ilike("title", `%${escapePostgrestString(q)}%`)
        .limit(5);
      for (const t of tasks || []) {
        results.push({ type: "task", id: t.id, name: t.title, extra: `${t.status} · ${t.area || ""}`, url: `/tareas` });
      }

      const { data: clients } = await supabase.from("clients")
        .select("id, name, rfc, status")
        .eq("organization_id", orgId)
        .or(`name.ilike.%${escapePostgrestString(q)}%,rfc.ilike.%${escapePostgrestString(q)}%`)
        .limit(5);
      for (const c of clients || []) {
        results.push({ type: "client", id: c.id, name: c.name, extra: c.rfc || c.status, url: `/clientes/${c.id}` });
      }

      const { data: projects } = await supabase.from("projects")
        .select("id, name, status, area")
        .eq("organization_id", orgId)
        .ilike("name", `%${escapePostgrestString(q)}%`)
        .limit(5);
      for (const p of projects || []) {
        results.push({ type: "project", id: p.id, name: p.name, extra: `${p.status} · ${p.area || ""}`, url: `/proyectos/${p.id}` });
      }

      return results;
    }

    case "get_extracted_documents": {
      let q = supabase.from("extracted_documents")
        .select("id, document_type, extraction_status, ai_summary, ai_observations, total_amount, tax_amount, isr_amount, iva_amount, rfc_emisor, rfc_receptor, fiscal_period, document_date, cfdi_type, declaration_type, currency, confidence_score")
        .eq("organization_id", orgId)
        .eq("extraction_status", "completed")
        .order("created_at", { ascending: false });
      if (args.client_id) q = q.eq("client_id", args.client_id);
      if (args.project_id) q = q.eq("project_id", args.project_id);
      q = q.limit(args.limit || 10);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }

    case "search_past_conversations": {
      const searchQuery = args.query;
      const limit = args.limit || 10;

      // SECURITY: Uses service role client, bypassing RLS to search across all org conversations.
      // TODO: Review if a scoped RLS policy per org would be safer than a full service-role bypass.
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const serviceClient = createClient(supabaseUrl, serviceKey);

      // Get all conversation IDs in the org
      const { data: orgConvos } = await serviceClient.from("chat_conversations")
        .select("id, user_id, title")
        .eq("organization_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (!orgConvos?.length) return { results: [], message: "No hay conversaciones previas." };

      const convoIds = orgConvos.map((c: any) => c.id);

      // Search messages across those conversations
      const { data: messages } = await serviceClient.from("chat_messages")
        .select("content, role, conversation_id, created_at")
        .in("conversation_id", convoIds)
        .ilike("content", `%${escapePostgrestString(searchQuery)}%`)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!messages?.length) return { results: [], message: "No se encontraron mensajes relacionados." };

      // Map conversation info
      const convoMap: Record<string, any> = {};
      for (const c of orgConvos) convoMap[c.id] = c;

      // Get user names for conversation owners
      const ownerIds = [...new Set(orgConvos.map((c: any) => c.user_id))];
      let nameMap: Record<string, string> = {};
      if (ownerIds.length) {
        const { data: profs } = await serviceClient.from("profiles").select("user_id, full_name").in("user_id", ownerIds);
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
      }

      return {
        results: messages.map((m: any) => {
          const convo = convoMap[m.conversation_id];
          const isCurrentUser = convo?.user_id === userId;
          return {
            fragmento: m.content.length > 300 ? m.content.substring(0, 300) + "..." : m.content,
            rol: m.role,
            fecha: m.created_at,
            conversacion: convo?.title || "Sin título",
            es_del_usuario_actual: isCurrentUser,
            autor: isCurrentUser ? "Tú" : (nameMap[convo?.user_id] || "Otro Kawiiler"),
          };
        }),
      };
    }

    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

// ─── Build system prompt ───
function buildSystemPrompt(profile: any) {
  return `Eres **Kawiil AI**, el asistente inteligente INTERNO de Kawiil — un despacho contable y legal en México que opera como un equipo unido de profesionales llamados "Kawiilers".

## IDENTIDAD Y VOZ
Hablas como un compañero de equipo más: cercano, profesional, motivador y directo. Usas un tono cálido pero eficiente. Tuteas al usuario. Cuando das información, no solo listas datos: **explicas qué significan y qué acción tomar**.

Ejemplos de tu estilo:
- En vez de "Tienes 5 tareas pendientes", di: "Tienes 5 pendientes esta semana — la más urgente es [X] que vence mañana. Te sugiero empezar por ahí 💪"
- En vez de "El proyecto está activo", di: "El proyecto de [Cliente] va avanzando bien, llevan completados los primeros 3 pasos. Lo que sigue es [siguiente paso]."

## CAPACIDADES PRINCIPALES

### 1. Resumen y priorización de trabajo
- Cuando pregunten "¿qué tengo pendiente?" o "¿por dónde empiezo?", consulta las tareas y organízalas por urgencia.
- Prioriza: vencimientos próximos > prioridad urgente/alta > tareas en progreso sin avance.
- Siempre sugiere un orden de acción claro.

### 2. Visión de equipo y motivación
- Muestra la carga de trabajo con contexto positivo y empático.
- Sugiere apoyo cuando detectes sobrecarga.

### 3. Conocimiento profundo de la plataforma
- Tienes acceso a comentarios de tareas, detalles de proyectos, actividad reciente y documentos procesados.
- **USA get_task_details** cuando necesites entender el contexto de una tarea específica, incluyendo las discusiones del equipo en los comentarios.
- **USA get_project_details** para dar un panorama completo de un proyecto con sus miembros y tareas.
- **USA get_recent_activity** para saber qué ha pasado recientemente en la organización.
- **USA get_extracted_documents** para consultar información fiscal extraída de documentos (CFDIs, declaraciones, etc.).
- **USA search_across** cuando necesites encontrar cualquier entidad por nombre.

### 4. Aprendizaje y memoria contextual
- Al responder, SIEMPRE cruza la información de múltiples fuentes: comentarios + descripción + actividad.
- Si el usuario pregunta sobre una persona, consulta sus tareas Y la actividad reciente para dar un panorama completo.
- Si pregunta sobre un cliente, consulta sus proyectos, tareas Y documentos extraídos.
- **USA search_past_conversations** para buscar si en conversaciones anteriores (tuyas o de otros Kawiilers) se ha discutido el tema. Si encuentras información relevante de otra conversación, menciónalo: "En una conversación anterior se discutió que..." sin revelar datos personales del otro usuario a menos que sea información de trabajo compartida.
- Aprende del contexto de la conversación para dar respuestas cada vez más relevantes.

### 5. Comunicación profesional
- Redacta correos, mensajes y documentos en español formal mexicano.
- Adapta el tono: formal para clientes/SAT, cercano para comunicación interna.

### 6. Conocimiento técnico
- Responde preguntas sobre temas contables, fiscales y legales de México: SAT, IMSS, ISR, IVA, DIOT, declaraciones, etc.
- Fomenta el aprendizaje: explica el "por qué" detrás de los procesos.

### 7. Guía y orientación (Hub de conocimiento)
- Para dudas de procesos internos, SIEMPRE busca primero en el Hub con get_hub_procedures.
- Consulta comunicados recientes con get_hub_comunicados.

## REGLAS DE SEGURIDAD
- Solo los Kawiilers tienen acceso. NUNCA compartas información con personas externas.
- No inventes datos: si no puedes obtener la información con las herramientas, dilo.

## CONTEXTO DEL USUARIO
- **Nombre**: ${profile?.full_name || "Kawiiler"}
- **Célula/Área**: ${profile?.area || "No asignada"}
- **Fecha actual**: ${new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" })}

## FORMATO
- Responde siempre en español con markdown.
- Usa emojis con moderación para dar calidez (✅ 🎯 💪 📋 🚀 ⚠️).
- Sé conciso pero completo. Prioriza claridad sobre longitud.
- Cuando listes tareas, incluye: nombre, prioridad, fecha límite, cliente (si aplica).`;
}

// ─── Convert messages between OpenAI <-> Anthropic formats ───
function toAnthropicMessages(openaiMessages: any[]): any[] {
  const msgs: any[] = [];
  for (const m of openaiMessages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      if (m.content) {
        msgs.push({ role: "assistant", content: m.content });
      }
    }
  }
  return msgs;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!ANTHROPIC_API_KEY && !LOVABLE_API_KEY) throw new Error("No AI provider configured");

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

    const { data: profile } = await supabase.from("profiles")
      .select("full_name, area, organization_id")
      .eq("user_id", user.id).single();

    const orgId = profile?.organization_id;
    const body = await req.json();
    const { messages, simple, searchMode, searchQuery } = body;
    const systemPrompt = buildSystemPrompt(profile);

    // ─── Direct search mode (structured results + optional AI summary) ───
    if (searchMode && searchQuery) {
      const results = await executeTool("search_across", { query: searchQuery }, supabase, user.id, orgId);

      // Try to generate a brief AI summary of the results
      let summary = "";
      if (Array.isArray(results) && results.length > 0) {
        try {
          const summaryPrompt = `El usuario buscó "${searchQuery}" en la plataforma. Estos son los resultados encontrados:\n${JSON.stringify(results, null, 2)}\n\nGenera un resumen breve (2-3 oraciones) en español que contextualice qué encontramos relacionado con "${searchQuery}". No listes los resultados, solo da contexto. Sé conciso y útil.`;

          const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          let summaryResp: Response | null = null;

          if (ANTHROPIC_API_KEY) {
            summaryResp = await fetch(ANTHROPIC_API_URL, {
              method: "POST",
              headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 256,
                messages: [{ role: "user", content: summaryPrompt }],
              }),
            });
          }

          if (!summaryResp?.ok && LOVABLE_API_KEY) {
            summaryResp = await fetch(AI_GATEWAY_URL, {
              method: "POST",
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [{ role: "user", content: summaryPrompt }],
                stream: false,
              }),
            });
          }

          if (summaryResp?.ok) {
            const sData = await summaryResp.json();
            // Handle both Anthropic and OpenAI response formats
            summary = sData.content?.find?.((b: any) => b.type === "text")?.text
              || sData.choices?.[0]?.message?.content
              || "";
          }
        } catch (e) {
          console.warn("Search summary generation failed (non-critical):", e);
        }
      }

      return new Response(JSON.stringify({ results, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Simple mode (no tools, no streaming) ───
    if (simple) {
      if (ANTHROPIC_API_KEY) {
        const resp = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2048,
            system: systemPrompt,
            messages: toAnthropicMessages(messages),
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const text = data.content?.find((b: any) => b.type === "text")?.text || "";
          return new Response(JSON.stringify({ content: text }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.warn("Claude simple failed, falling back...");
      }
      if (LOVABLE_API_KEY) {
        const resp = await fetch(AI_GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: [{ role: "system", content: systemPrompt }, ...messages], stream: false }),
        });
        if (resp.ok) {
          const data = await resp.json();
          return new Response(JSON.stringify({ content: data.choices?.[0]?.message?.content || "" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Main chat with tools (Claude primary) ───
    if (ANTHROPIC_API_KEY) {
      try {
        return await handleClaudeChat(ANTHROPIC_API_KEY, systemPrompt, messages, supabase, user.id, orgId);
      } catch (e) {
        console.warn("Claude chat failed, falling back to gateway:", e instanceof Error ? e.message : e);
      }
    }

    // ─── Fallback: Lovable AI Gateway (OpenAI format) ───
    if (LOVABLE_API_KEY) {
      return await handleGatewayChat(LOVABLE_API_KEY, systemPrompt, messages, supabase, user.id, orgId);
    }

    return new Response(JSON.stringify({ error: "No AI provider available" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Claude (Anthropic) handler ───
async function handleClaudeChat(
  apiKey: string, systemPrompt: string, userMessages: any[],
  supabase: any, userId: string, orgId: string,
): Promise<Response> {
  let anthropicMsgs = toAnthropicMessages(userMessages);
  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const isLastChance = round === MAX_ROUNDS - 1;

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMsgs,
        tools: isLastChance ? undefined : anthropicTools,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      // On 429, throw so the main handler catches and falls back to gateway
      if (resp.status === 429) {
        console.warn("Claude 429 rate limit, will fallback to gateway");
        throw new Error("RATE_LIMIT_429");
      }
      throw new Error(`Claude error ${resp.status}: ${errText.substring(0, 300)}`);
    }

    const data = await resp.json();
    const stopReason = data.stop_reason;
    const contentBlocks = data.content || [];

    const toolUseBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");

    if (toolUseBlocks.length > 0 && stopReason === "tool_use") {
      anthropicMsgs.push({ role: "assistant", content: contentBlocks });

      const toolResults: any[] = [];
      for (const tu of toolUseBlocks) {
        console.log(`Tool [Claude]: ${tu.name}`, tu.input);
        const result = await executeTool(tu.name, tu.input || {}, supabase, userId, orgId);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      anthropicMsgs.push({ role: "user", content: toolResults });
      continue;
    }

    const textContent = contentBlocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    return streamTextAsSSE(textContent);
  }

  return new Response(JSON.stringify({ error: "Demasiadas consultas internas" }), {
    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Gateway (OpenAI format) fallback handler ───
async function handleGatewayChat(
  apiKey: string, systemPrompt: string, userMessages: any[],
  supabase: any, userId: string, orgId: string,
): Promise<Response> {
  let aiMessages: any[] = [{ role: "system", content: systemPrompt }, ...userMessages];
  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: aiMessages,
        tools: openaiTools,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Intenta de nuevo en unos segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const choice = data.choices[0];
    const msg = choice.message;
    aiMessages.push(msg);

    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        console.log(`Tool [Gateway]: ${tc.function.name}`, args);
        const result = await executeTool(tc.function.name, args, supabase, userId, orgId);
        aiMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    return streamTextAsSSE(msg.content || "");
  }

  return new Response(JSON.stringify({ error: "Demasiadas consultas internas" }), {
    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Stream text as OpenAI-compatible SSE ───
function streamTextAsSSE(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const chunkSize = 20;
      for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}
