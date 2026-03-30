import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { DB } from "https://deno.land/x/sqlite@v3.7.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
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

const CHAT_ATTACH_MAX_FILES = 20;
const CHAT_ATTACH_MAX_BYTES = 50 * 1024 * 1024;
const CHAT_ATTACH_BATCH_MAX_BYTES = 150 * 1024 * 1024;
const CHAT_TEXT_EXTRACT_MAX = 120_000;

async function assertAiProjectAccess(
  svc: ReturnType<typeof createClient>,
  aiProjectId: string | null | undefined,
  userId: string,
  orgId: string | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
  if (!aiProjectId) return { ok: true };
  if (!orgId) return { ok: false, error: "Sin organización" };
  const { data: ap } = await svc.from("ai_projects")
    .select("id, organization_id, user_id")
    .eq("id", aiProjectId)
    .maybeSingle();
  if (!ap) return { ok: false, error: "Proyecto de IA no encontrado" };
  if (ap.organization_id !== orgId) return { ok: false, error: "Acceso denegado al proyecto" };
  if (ap.user_id === userId) return { ok: true };
  const { data: mem } = await svc.from("ai_project_members")
    .select("role")
    .eq("ai_project_id", aiProjectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (mem) return { ok: true };
  return { ok: false, error: "No eres miembro de este proyecto de IA" };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

function isLikelySqlite(bytes: Uint8Array): boolean {
  const sig = new TextDecoder().decode(bytes.subarray(0, 16));
  return sig.startsWith("SQLite format 3");
}

async function downloadStorageObject(
  svc: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await svc.storage.from(bucket).download(path);
  if (error || !data) {
    console.warn("storage download failed", bucket, path, error?.message);
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[…contenido truncado por tamaño…]";
}

async function pdfBytesToGatewayText(bytes: Uint8Array, name: string): Promise<string> {
  const fallback =
    `[PDF: ${name}] No se pudo extraer texto automáticamente; si usas solo el gateway, prueba otro formato o activa Anthropic.`;
  try {
    const { extractText, getDocumentProxy } = await import(
      "https://esm.sh/unpdf@0.12.1",
    ) as {
      extractText: (pdf: unknown, opts?: { mergePages?: boolean }) => Promise<{ text?: string }>;
      getDocumentProxy: (data: Uint8Array) => Promise<unknown>;
    };
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const t = (text || "").trim();
    if (!t) return fallback;
    return `### ${name} (PDF, texto extraído)\n${truncateText(t, CHAT_TEXT_EXTRACT_MAX)}`;
  } catch (e) {
    console.warn("pdf extract", e);
    return fallback;
  }
}

function xlsxBytesToText(bytes: Uint8Array): string {
  try {
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    const maxRowsPerSheet = 200;
    for (const sheetName of wb.SheetNames.slice(0, 10)) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
      const lines = csv.split("\n");
      parts.push(`## Hoja: ${sheetName}\n${lines.slice(0, maxRowsPerSheet).join("\n")}`);
    }
    return truncateText(parts.join("\n\n"), CHAT_TEXT_EXTRACT_MAX);
  } catch (e) {
    console.warn("xlsx parse error", e);
    return "[No se pudo leer el Excel como tabla.]";
  }
}

async function sqliteBytesToSummary(bytes: Uint8Array): Promise<string> {
  const tmp = await Deno.makeTempFile();
  try {
    await Deno.writeFile(tmp, bytes);
    const db = new DB(tmp);
    const tables = [...db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
      .map((r) => String(r[0]));
    const parts: string[] = [`Tablas: ${tables.join(", ") || "(ninguna)"}`];
    for (const t of tables.slice(0, 8)) {
      try {
        const cnt = [...db.query(`SELECT COUNT(*) FROM "${t.replace(/"/g, '""')}"`)][0][0];
        const rows = [...db.query(`SELECT * FROM "${t.replace(/"/g, '""')}" LIMIT 12`)];
        parts.push(`\n## ${t} (${cnt} filas, muestra hasta 12)\n${JSON.stringify(rows, null, 2)}`);
      } catch { /* ignore */ }
    }
    db.close();
    return truncateText(parts.join("\n"), CHAT_TEXT_EXTRACT_MAX);
  } catch (e) {
    console.warn("sqlite read error", e);
    return "[No se pudo leer el archivo SQLite.]";
  } finally {
    try {
      await Deno.remove(tmp);
    } catch { /* ignore */ }
  }
}

async function processAttachmentFile(
  bytes: Uint8Array,
  mime: string,
  name: string,
): Promise<{ claude: any[]; gatewayText: string }> {
  const lower = name.toLowerCase();
  const mt = (mime || "").toLowerCase();

  if (mt.startsWith("image/")) {
    const media = mt === "image/png" || mt === "image/gif" || mt === "image/webp" || mt === "image/jpeg"
      ? mt
      : "image/jpeg";
    return {
      claude: [{ type: "image", source: { type: "base64", media_type: media, data: toBase64(bytes) } }],
      gatewayText: `[Imagen adjunta: ${name}]`,
    };
  }
  if (mt === "application/pdf" || lower.endsWith(".pdf")) {
    const gatewayText = await pdfBytesToGatewayText(bytes, name);
    return {
      claude: [{
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) },
      }],
      gatewayText,
    };
  }
  if (
    mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mt === "application/vnd.ms-excel" ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls")
  ) {
    const t = xlsxBytesToText(bytes);
    return { claude: [{ type: "text", text: `Contenido de ${name}:\n${t}` }], gatewayText: `### ${name}\n${t}` };
  }
  if (lower.endsWith(".sqlite") || lower.endsWith(".db") || isLikelySqlite(bytes)) {
    const t = await sqliteBytesToSummary(bytes);
    return { claude: [{ type: "text", text: `Resumen SQLite ${name}:\n${t}` }], gatewayText: `### ${name}\n${t}` };
  }
  if (
    mt.startsWith("text/") ||
    mt === "application/json" ||
    mt === "application/csv" ||
    lower.endsWith(".csv") ||
    lower.endsWith(".md") ||
    lower.endsWith(".sql")
  ) {
    const dec = new TextDecoder("utf-8", { fatal: false });
    const t = truncateText(dec.decode(bytes), CHAT_TEXT_EXTRACT_MAX);
    return { claude: [{ type: "text", text: `Archivo ${name}:\n${t}` }], gatewayText: `### ${name}\n${t}` };
  }
  return {
    claude: [{ type: "text", text: `[Archivo binario no interpretado: ${name} (${mt || "sin tipo"})]` }],
    gatewayText: `[Adjunto sin vista previa de texto: ${name}]`,
  };
}

function findLastUserMessageIndex(messages: any[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

async function resolveChatAttachments(
  svc: ReturnType<typeof createClient>,
  messages: any[],
  attachmentRefs: Array<{ bucket?: string; path: string; name?: string; mime_type?: string }> | undefined,
): Promise<{ forClaude: any[]; forGateway: any[] }> {
  const refs = (attachmentRefs || []).slice(0, CHAT_ATTACH_MAX_FILES);
  const lastIdx = findLastUserMessageIndex(messages);
  if (lastIdx < 0 || refs.length === 0) {
    return { forClaude: messages, forGateway: messages };
  }

  const userText = typeof messages[lastIdx].content === "string" ? messages[lastIdx].content : "";
  const claudeBlocks: any[] = [];
  const gatewayParts: string[] = [];
  let batchBytes = 0;
  const maxMb = Math.round(CHAT_ATTACH_MAX_BYTES / (1024 * 1024));
  const maxBatchMb = Math.round(CHAT_ATTACH_BATCH_MAX_BYTES / (1024 * 1024));

  for (const ref of refs) {
    const bucket = ref.bucket || "chat-uploads";
    const bytes = await downloadStorageObject(svc, bucket, ref.path);
    if (!bytes) {
      gatewayParts.push(`No se pudo leer: ${ref.name || ref.path}`);
      continue;
    }
    if (bytes.length > CHAT_ATTACH_MAX_BYTES) {
      gatewayParts.push(`Archivo demasiado grande (máx ${maxMb}MB): ${ref.name}`);
      continue;
    }
    if (batchBytes + bytes.length > CHAT_ATTACH_BATCH_MAX_BYTES) {
      gatewayParts.push(`Omitido (supera ${maxBatchMb}MB total por mensaje): ${ref.name}`);
      continue;
    }
    batchBytes += bytes.length;
    const proc = await processAttachmentFile(bytes, ref.mime_type || "", ref.name || "archivo");
    claudeBlocks.push(...proc.claude);
    if (proc.gatewayText) gatewayParts.push(proc.gatewayText);
  }

  let claudeContent: any = userText;
  if (claudeBlocks.length) {
    const arr = [...claudeBlocks];
    if (userText.trim()) arr.push({ type: "text", text: userText.trim() });
    claudeContent = arr.length === 1 && arr[0].type === "text" ? arr[0].text : arr;
  }

  const forClaude = messages.map((m, i) => (i === lastIdx ? { ...m, content: claudeContent } : m));
  const gwAppend = gatewayParts.length ? `\n\n--- Archivos adjuntos ---\n${gatewayParts.join("\n\n")}` : "";
  const forGateway = messages.map((m, i) =>
    i === lastIdx ? { ...m, content: userText + gwAppend } : m
  );

  return { forClaude, forGateway };
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
  {
    name: "semantic_search",
    description: "Búsqueda semántica en la base de conocimiento de Kawiil usando embeddings vectoriales. Encuentra información relevante en documentos procesados, conversaciones anteriores, procedimientos internos y comunicados — incluso si no coinciden las palabras exactas. ÚSALA cuando el usuario pregunte sobre un tema, cliente, ley, procedimiento o concepto. Es más potente que search_across y search_past_conversations para encontrar contexto conceptual.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pregunta o tema a buscar semánticamente" },
        client_id: { type: "string", description: "Filtrar por cliente específico (UUID)" },
        project_id: { type: "string", description: "Filtrar por proyecto específico (UUID)" },
        source_types: {
          type: "array",
          items: { type: "string", enum: ["document", "extracted_data", "chat_message", "procedure", "comunicado", "memory", "artifact", "shared_memory"] },
          description: "Filtrar por tipos de fuente. Omitir para buscar en todo.",
        },
        limit: { type: "number", description: "Máximo de resultados (default 8)" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_artifact",
    description: "Crea un documento/artifact estructurado (manual, reporte, análisis, matriz, guía, plantilla). USA ESTA HERRAMIENTA cuando el usuario pida generar un documento largo, manual, reporte o cualquier contenido que merezca su propia vista. El artifact aparecerá en un panel lateral para que el usuario lo vea, copie o descargue.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del documento" },
        content: { type: "string", description: "Contenido completo en Markdown" },
        content_type: { type: "string", enum: ["markdown", "code", "html", "csv"], description: "Tipo de contenido (default: markdown)" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "create_project",
    description: "Crea un nuevo proyecto en Kawiil. USA ESTA HERRAMIENTA cuando el usuario pida crear un proyecto, ya sea directamente o a partir de una minuta de reunión, un análisis o instrucciones. Puedes asociar el proyecto a un cliente existente y definir el área de servicio. Incluye fases si el proyecto lo requiere.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del proyecto" },
        description: { type: "string", description: "Descripción del proyecto" },
        client_id: { type: "string", description: "UUID del cliente (opcional)" },
        area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"], description: "Área/célula de servicio" },
        service_tags: { type: "array", items: { type: "string" }, description: "Tags de servicio adicionales (ej: auditoria_interna, control_interno)" },
        phases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              order: { type: "number" },
            },
            required: ["name"],
          },
          description: "Fases del proyecto (opcional)",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              phase_name: { type: "string", description: "Nombre de la fase a la que pertenece esta tarea" },
              priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
              due_date: { type: "string", description: "YYYY-MM-DD" },
            },
            required: ["title"],
          },
          description: "Tareas iniciales del proyecto",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_tasks",
    description: "Crea múltiples tareas de una sola vez. USA ESTA HERRAMIENTA cuando el usuario pida crear tareas para un proyecto, a partir de una minuta, o a partir de instrucciones. Puedes crear tareas con prioridad, área, fecha límite y asignarlas a un proyecto existente.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "UUID del proyecto al que pertenecen (opcional)" },
        client_id: { type: "string", description: "UUID del cliente (opcional)" },
        area: { type: "string", description: "Área por defecto para las tareas" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
              due_date: { type: "string", description: "YYYY-MM-DD" },
              phase_key: { type: "string", description: "Key de la fase del proyecto" },
            },
            required: ["title"],
          },
          description: "Lista de tareas a crear",
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "suggest_template",
    description: "Sugiere una plantilla de proyecto basándose en el tipo de cliente, servicio y descripción. Busca plantillas existentes o genera una sugerencia adaptada.",
    input_schema: {
      type: "object",
      properties: {
        client_type: { type: "string", description: "Tipo de cliente (persona_moral, persona_fisica)" },
        service_area: { type: "string", description: "Área de servicio" },
        service_tags: { type: "array", items: { type: "string" }, description: "Tags de servicio" },
        description: { type: "string", description: "Descripción de lo que necesita el proyecto" },
      },
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

    case "semantic_search": {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return { error: "Búsqueda semántica no disponible: OPENAI_API_KEY no configurada" };

      const queryText = args.query;
      const limit = args.limit || 8;

      // Generate embedding for the query
      const embResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: queryText.replace(/\n+/g, " ").trim(),
          model: "text-embedding-3-small",
          dimensions: 1536,
        }),
      });

      if (!embResp.ok) {
        const err = await embResp.text();
        console.error("OpenAI embedding error:", err);
        return { error: "No se pudo generar el embedding para la búsqueda" };
      }

      const embData = await embResp.json();
      const queryEmbedding = embData.data[0].embedding;

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const serviceClient = createClient(supabaseUrl, serviceKey);

      const { data: results, error: rpcError } = await serviceClient.rpc("match_document_chunks", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: limit,
        filter_org_id: orgId,
        filter_client_id: args.client_id || null,
        filter_project_id: args.project_id || null,
        filter_source_types: args.source_types || null,
        similarity_threshold: 0.35,
      });

      if (rpcError) {
        console.error("match_document_chunks RPC error:", rpcError);
        return { error: rpcError.message };
      }

      if (!results?.length) {
        return { results: [], message: "No se encontraron resultados semánticos relevantes." };
      }

      return {
        results: results.map((r: any) => ({
          contenido: r.content.length > 500 ? r.content.substring(0, 500) + "..." : r.content,
          tipo_fuente: r.source_type,
          similitud: Math.round(r.similarity * 100) + "%",
          metadata: r.metadata,
          client_id: r.client_id,
          project_id: r.project_id,
        })),
        total: results.length,
        query: queryText,
      };
    }

    case "create_project": {
      const projectPhases = (args.phases || []).map((p: any, i: number) => ({
        key: `phase_${Date.now()}_${i}`,
        name: p.name,
        order: p.order ?? i,
      }));

      const { data: project, error } = await supabase.from("projects").insert({
        name: args.name,
        description: args.description || null,
        client_id: args.client_id || null,
        area: args.area || null,
        organization_id: orgId,
        created_by: userId,
        responsible_user_id: userId,
        tax_obligations: [],
        phases: projectPhases,
        service_tags: args.service_tags || [],
      }).select("id, name, area, status").single();
      if (error) return { error: error.message };

      // Create tasks if provided inline
      const taskResults: any[] = [];
      for (const task of args.tasks || []) {
        let phaseKey: string | null = null;
        if (task.phase_name) {
          const matched = projectPhases.find((p: any) => p.name.toLowerCase() === task.phase_name.toLowerCase());
          if (matched) phaseKey = matched.key;
        }
        const { data: td, error: te } = await supabase.from("tasks").insert({
          title: task.title,
          project_id: project.id,
          client_id: args.client_id || null,
          organization_id: orgId,
          created_by: userId,
          assigned_to: userId,
          area: args.area || null,
          priority: task.priority || "media",
          due_date: task.due_date || null,
          phase_key: phaseKey,
          status: "pendiente",
        }).select("id, title").single();
        taskResults.push(td || { title: task.title, error: te?.message });
      }

      // Save as template for future AI suggestions
      const svcUrlT = Deno.env.get("SUPABASE_URL")!;
      const svcKeyT = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const svcT = createClient(svcUrlT, svcKeyT);
      await svcT.from("project_templates").insert({
        name: args.name,
        description: args.description || null,
        area: args.area || null,
        phases: projectPhases,
        suggested_tasks: (args.tasks || []).map((t: any) => ({ title: t.title, phase_name: t.phase_name })),
        is_ai_generated: true,
        organization_id: orgId,
        created_by: userId,
        service_tags: args.service_tags || [],
      });

      return {
        success: true,
        project,
        phases: projectPhases,
        tasks_created: taskResults.filter((r) => !r.error).length,
        tasks: taskResults,
        url: `/proyectos/${project.id}`,
      };
    }

    case "create_tasks": {
      const results: any[] = [];
      for (const task of args.tasks || []) {
        const { data, error } = await supabase.from("tasks").insert({
          title: task.title,
          description: task.description || null,
          project_id: args.project_id || null,
          client_id: args.client_id || null,
          organization_id: orgId,
          created_by: userId,
          assigned_to: userId,
          area: args.area || null,
          priority: task.priority || "media",
          due_date: task.due_date || null,
          phase_key: task.phase_key || null,
          status: "pendiente",
        }).select("id, title, priority, status").single();
        if (error) {
          results.push({ title: task.title, error: error.message });
        } else {
          results.push(data);
        }
      }
      return { success: true, created: results.filter((r) => !r.error).length, tasks: results };
    }

    case "suggest_template": {
      let q = supabase.from("project_templates").select("id, name, description, area, phases, suggested_tasks, service_tags, client_type, avg_duration_days, usage_count").eq("organization_id", orgId);
      if (args.service_area) q = q.eq("area", args.service_area);
      const { data: tpls } = await q.order("usage_count", { ascending: false }).limit(10);
      if (!tpls || tpls.length === 0) {
        return { templates: [], suggestion: "No se encontraron plantillas. Se puede crear el proyecto desde cero y guardar como plantilla al finalizar." };
      }
      const filtered = tpls.filter((t: any) => {
        if (args.client_type && t.client_type && t.client_type !== args.client_type) return false;
        if (args.service_tags?.length) {
          const overlap = (t.service_tags || []).some((st: string) => args.service_tags.includes(st));
          if (!overlap && t.service_tags?.length) return false;
        }
        return true;
      });
      return {
        templates: (filtered.length > 0 ? filtered : tpls).slice(0, 5).map((t: any) => ({
          id: t.id, name: t.name, description: t.description, area: t.area,
          phases_count: (t.phases || []).length, tasks_count: (t.suggested_tasks || []).length,
          usage_count: t.usage_count || 0, service_tags: t.service_tags || [],
        })),
        suggestion: filtered.length > 0
          ? `Encontré ${filtered.length} plantilla(s) relevantes. La más usada es "${filtered[0].name}".`
          : `No hay plantillas exactas pero estas ${Math.min(tpls.length, 5)} podrían adaptarse.`,
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

### 4. Memoria y base de conocimiento (RAG)
- Tienes acceso a una **base de conocimiento vectorial** con documentos, conversaciones previas, procedimientos, comunicados y **memorias persistentes**.
- **USA semantic_search PRIMERO** cuando el usuario pregunte sobre un tema, ley, procedimiento, cliente o concepto. Es tu herramienta más potente: encuentra información relevante incluso si las palabras exactas no coinciden.
- Cuando busques sobre un cliente específico, pasa el client_id como filtro para resultados más precisos.
- Si semantic_search no encuentra suficiente info, complementa con search_past_conversations (búsqueda exacta en conversaciones) y search_across (búsqueda en tareas/clientes/proyectos).
- Al responder, SIEMPRE cruza la información de múltiples fuentes: conocimiento base + memorias + comentarios + descripción + actividad.
- Si el usuario pregunta sobre una persona, consulta sus tareas Y la actividad reciente para dar un panorama completo.
- Si pregunta sobre un cliente, consulta sus proyectos, tareas, documentos extraídos Y memorias guardadas.
- Si encuentras información de la base de conocimiento o memorias, cítala: "Según mis notas..." o "En un análisis anterior guardé que..."
- **GUARDA en memoria** todo insight valioso: conclusiones de análisis, datos clave de clientes, estrategias discutidas, decisiones tomadas. Esto construye conocimiento real que perdura entre conversaciones.

### 5. Generación de documentos (Artifacts)
- Cuando el usuario pida generar un **documento largo** (manual, reporte, análisis, matriz, guía, plantilla, procedimiento), USA la herramienta **create_artifact** en lugar de poner el contenido directamente en el chat.
- Los artifacts aparecen en un panel lateral donde el usuario puede verlos completos, copiarlos o descargarlos.
- Usa create_artifact cuando el contenido generado supere ~500 palabras o sea un documento formal/estructurado.
- El artifact debe estar completo y bien formateado en Markdown.
- Después de crear un artifact, incluye un breve resumen en el chat de lo que generaste y por qué.

### 5b. Creación de proyectos y tareas
- **USA create_project** cuando el usuario pida crear un proyecto nuevo, ya sea directamente ("crea un proyecto de..."), analizando una minuta de reunión, o cuando del contexto se deduzca que hay que crear un nuevo proyecto. Puedes incluir fases y tareas directamente en la herramienta.
- **USA create_tasks** cuando el usuario pida crear tareas, ya sea a partir de instrucciones directas, una minuta, un análisis, o fases de un proyecto. Puedes crear múltiples tareas de una vez.
- **USA suggest_template** para buscar plantillas relevantes cuando el usuario quiera crear un proyecto similar a uno anterior.
- Cuando el usuario comparta una minuta o notas de reunión, analiza el contenido y propón la creación del proyecto y tareas correspondientes. Confirma con el usuario antes de crearlos, a menos que el usuario diga explícitamente "crea las tareas".
- Al crear proyectos, intenta identificar el cliente y área correctos basándote en el contexto.
- Al crear tareas, asigna prioridades inteligentemente según la urgencia y la naturaleza de la tarea.
- **IMPORTANTE:** Cuando crees un proyecto exitosamente, SIEMPRE incluye en tu respuesta el marcador [project:UUID_DEL_PROYECTO|NOMBRE_DEL_PROYECTO|AREA] para que aparezca una tarjeta visual del proyecto en el chat. Ejemplo: [project:abc-123|Contabilidad Grupo Dazon|contabilidad]

### 6. Comunicación profesional
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
      if (m.content !== undefined && m.content !== null && m.content !== "") {
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
    const { messages, simple, searchMode, searchQuery, ai_project_id, attachmentRefs } = body;

    const svcUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(svcUrl, serviceKey);

    const access = await assertAiProjectAccess(svc, ai_project_id, user.id, orgId ?? null);
    if (!access.ok) {
      return new Response(JSON.stringify({ error: access.error }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { forClaude, forGateway } = await resolveChatAttachments(svc, messages || [], attachmentRefs);

    // Load AI Project context + memories
    let projectContext = "";

    if (ai_project_id) {
      const { data: aiProject } = await svc.from("ai_projects")
        .select("name, description, instructions, client_id, project_id")
        .eq("id", ai_project_id)
        .single();

      if (aiProject) {
        projectContext = `\n\n## PROYECTO DE IA ACTIVO: ${aiProject.name}`;
        if (aiProject.description) projectContext += `\nDescripción: ${aiProject.description}`;
        if (aiProject.instructions) projectContext += `\n\n### Instrucciones del proyecto:\n${aiProject.instructions}`;
        if (aiProject.client_id) projectContext += `\n- Filtrar búsquedas semánticas por client_id: ${aiProject.client_id}`;
        if (aiProject.project_id) projectContext += `\n- Filtrar búsquedas semánticas por project_id: ${aiProject.project_id}`;

        const { data: projDocs } = await svc.from("ai_project_documents")
          .select("name, source, dropbox_path")
          .eq("ai_project_id", ai_project_id);

        if (projDocs?.length) {
          projectContext += `\n\n### Documentos vinculados al proyecto (${projDocs.length}):`;
          for (const d of projDocs) {
            projectContext += `\n- ${d.name} (${d.source})`;
          }
          projectContext += `\nUsa semantic_search para buscar en estos documentos cuando sea relevante.`;
        }
      }
    }

    // Load existing memories for this context
    let memQuery = svc.from("ai_project_memories")
      .select("path, content, updated_at")
      .eq("user_id", user.id)
      .eq("organization_id", orgId);
    if (ai_project_id) memQuery = memQuery.eq("ai_project_id", ai_project_id);
    else memQuery = memQuery.is("ai_project_id", null);
    const { data: memories } = await memQuery.order("path");

    let sharedMemories: { path: string; content: string; updated_at: string }[] = [];
    if (ai_project_id) {
      const { data: sm } = await svc.from("ai_project_shared_memories")
        .select("path, content, updated_at")
        .eq("ai_project_id", ai_project_id)
        .order("path");
      sharedMemories = sm || [];
    }

    projectContext += `\n\n### Memoria persistente (Memory Tool)
- **Personal** (solo el usuario): rutas bajo \`/memories/\` — notas privadas del Kawiiler.
- **Equipo** (proyecto de IA compartido): rutas bajo \`/team/\` — visibles para todos los miembros del proyecto. Requiere proyecto de IA activo.
- COMANDOS: 'view', 'create', 'str_replace', 'insert', 'delete', 'rename'.
- Usa \`/team/\` para decisiones y contexto que deban ver colegas en el mismo proyecto de IA.`;

    if (memories?.length) {
      projectContext += `\n\n**Memorias personales (${memories.length}):**`;
      for (const m of memories) {
        const preview = m.content.substring(0, 120).replace(/\n/g, " ");
        projectContext += `\n- \`${m.path}\` — ${preview}…`;
      }
    } else {
      projectContext += `\n\nSin memorias personales en /memories/ todavía.`;
    }

    if (sharedMemories.length) {
      projectContext += `\n\n**Memoria de equipo /team/ (${sharedMemories.length} archivos):**`;
      for (const m of sharedMemories) {
        const preview = m.content.substring(0, 120).replace(/\n/g, " ");
        projectContext += `\n- \`${m.path}\` — ${preview}…`;
      }
    } else if (ai_project_id) {
      projectContext += `\n\nAún no hay memorias de equipo (/team/). Crea con memory create en rutas /team/archivo.md cuando el conocimiento deba compartirse.`;
    }

    const systemPrompt = buildSystemPrompt(profile) + projectContext;

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
            messages: toAnthropicMessages(forClaude),
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
          body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: [{ role: "system", content: systemPrompt }, ...forGateway], stream: false }),
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
        return await handleClaudeChat(ANTHROPIC_API_KEY, systemPrompt, forClaude, supabase, user.id, orgId, ai_project_id || null);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Claude chat failed:", errMsg);
        // If it's a rate limit, try gateway; otherwise return the error directly
        if (!errMsg.includes("RATE_LIMIT_429")) {
          // ─── Fallback: Lovable AI Gateway (OpenAI format) ───
          if (LOVABLE_API_KEY) {
            return await handleGatewayChat(LOVABLE_API_KEY, systemPrompt, forGateway, supabase, user.id, orgId);
          }
          return new Response(JSON.stringify({ error: errMsg }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // ─── Fallback: Lovable AI Gateway (OpenAI format) ───
    if (LOVABLE_API_KEY) {
      return await handleGatewayChat(LOVABLE_API_KEY, systemPrompt, forGateway, supabase, user.id, orgId);
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

// ─── Artifact Tool handler ───
async function handleCreateArtifact(
  input: any, userId: string, orgId: string, aiProjectId: string | null,
): Promise<string> {
  const svcUrlA = Deno.env.get("SUPABASE_URL")!;
  const serviceKeyA = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(svcUrlA, serviceKeyA);

  const { title, content, content_type } = input;
  if (!title || !content) return JSON.stringify({ error: "title and content are required" });

  const { data: artifact, error } = await svc.from("ai_artifacts").insert({
    ai_project_id: aiProjectId || null,
    user_id: userId,
    organization_id: orgId,
    title,
    content,
    content_type: content_type || "markdown",
  }).select("id").single();

  if (error) {
    console.error("Artifact insert error:", error);
    return JSON.stringify({ error: error.message });
  }

  // Auto-embed the artifact content
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey && content.length > 30) {
    try {
      const textToEmbed = `[Artifact: ${title}] ${content}`.replace(/\n+/g, " ").trim().substring(0, 8000);
      const embResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: textToEmbed, model: "text-embedding-3-small", dimensions: 1536 }),
      });
      if (embResp.ok) {
        const embData = await embResp.json();
        await svc.from("document_chunks").insert({
          organization_id: orgId,
          source_type: "artifact",
          source_id: artifact.id,
          content: `[Artifact: ${title}] ${content}`.substring(0, 4000),
          metadata: { title, ai_project_id: aiProjectId, content_type: content_type || "markdown" },
          embedding: JSON.stringify(embData.data[0].embedding),
          token_count: Math.ceil(textToEmbed.length / 3.5),
        });
      }
    } catch (e) {
      console.error("Artifact embedding failed (non-blocking):", e);
    }
  }

  return JSON.stringify({
    artifact_id: artifact.id,
    title,
    content_type: content_type || "markdown",
    message: `Artifact "${title}" creado exitosamente.`,
  });
}

function normalizeTeamMemoryPath(memPath: string): string {
  if (memPath.startsWith("/team/")) return memPath;
  if (memPath.startsWith("team/")) return `/${memPath}`;
  return `/team/${memPath.replace(/^\/+/, "")}`;
}

function isTeamMemoryPath(memPath: string | undefined): boolean {
  return !!memPath && (memPath.startsWith("/team") || memPath.startsWith("team/"));
}

// ─── Memory Tool handler (backed by Supabase) ───
async function handleMemoryToolCall(
  input: any, userId: string, orgId: string, aiProjectId: string | null,
): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  const { command, path: memPath, content, old_str, new_str, view_range } = input;

  switch (command) {
    case "view": {
      if (memPath === "/team" || memPath === "/team/") {
        if (!aiProjectId) return "No hay proyecto de IA activo para listar /team/.";
        const { data: teamFiles } = await svc.from("ai_project_shared_memories")
          .select("path, updated_at, content")
          .eq("ai_project_id", aiProjectId)
          .order("path");
        if (!teamFiles?.length) return "El directorio /team/ está vacío.";
        const listing = teamFiles.map((f) => {
          const sizeKB = (new TextEncoder().encode(f.content).length / 1024).toFixed(1);
          return `${sizeKB}K\t${f.path}`;
        }).join("\n");
        return `Archivos en /team/ (memoria compartida del proyecto):\n${listing}`;
      }

      if (!memPath || memPath === "/memories" || memPath === "/memories/") {
        let query = svc.from("ai_project_memories")
          .select("path, updated_at, content")
          .eq("user_id", userId)
          .eq("organization_id", orgId);
        if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
        else query = query.is("ai_project_id", null);
        const { data: files } = await query.order("path");

        let out = "";
        if (files?.length) {
          const listing = files.map((f) => {
            const sizeKB = (new TextEncoder().encode(f.content).length / 1024).toFixed(1);
            return `${sizeKB}K\t${f.path}`;
          }).join("\n");
          out = `Archivos en /memories/ (personales):\n${listing}`;
        } else {
          out = "/memories/ está vacío para este contexto.";
        }
        if (aiProjectId) {
          const { data: teamFiles } = await svc.from("ai_project_shared_memories")
            .select("path, updated_at, content")
            .eq("ai_project_id", aiProjectId)
            .order("path");
          if (teamFiles?.length) {
            const tl = teamFiles.map((f) => {
              const sizeKB = (new TextEncoder().encode(f.content).length / 1024).toFixed(1);
              return `${sizeKB}K\t${f.path}`;
            }).join("\n");
            out += `\n\nArchivos en /team/ (equipo):\n${tl}`;
          }
        }
        return out;
      }

      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren un proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("content")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .maybeSingle();
        if (!file) return `The path ${tp} does not exist.`;
        let lines = file.content.split("\n");
        if (view_range && Array.isArray(view_range) && view_range.length === 2) {
          const [start, end] = view_range;
          lines = lines.slice(Math.max(0, start - 1), end);
        }
        const numbered = lines.map((l: string, i: number) => `${String(i + 1).padStart(6)} \t${l}`).join("\n");
        return `Here's the content of ${tp} with line numbers:\n${numbered}`;
      }

      let query = svc.from("ai_project_memories")
        .select("content")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist. Please provide a valid path.`;

      let lines = file.content.split("\n");
      if (view_range && Array.isArray(view_range) && view_range.length === 2) {
        const [start, end] = view_range;
        lines = lines.slice(Math.max(0, start - 1), end);
      }
      const numbered = lines.map((l: string, i: number) => `${String(i + 1).padStart(6)} \t${l}`).join("\n");
      return `Here's the content of ${memPath} with line numbers:\n${numbered}`;
    }

    case "create": {
      if (!memPath || !content) return "Error: path and content are required for create.";
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Las rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: ap } = await svc.from("ai_projects").select("organization_id").eq("id", aiProjectId).single();
        if (!ap) return "Proyecto no encontrado.";
        const { data: existing } = await svc.from("ai_project_shared_memories")
          .select("id")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .maybeSingle();
        let rowId: string;
        if (existing) {
          await svc.from("ai_project_shared_memories")
            .update({ content, updated_at: new Date().toISOString(), updated_by: userId })
            .eq("id", existing.id);
          rowId = existing.id;
        } else {
          const { data: ins } = await svc.from("ai_project_shared_memories").insert({
            ai_project_id: aiProjectId,
            organization_id: ap.organization_id,
            path: tp,
            content,
            updated_by: userId,
          }).select("id").single();
          rowId = ins!.id;
        }
        await embedSharedMemory(svc, tp, content, ap.organization_id, aiProjectId, rowId);
        return `Successfully wrote team memory to ${tp} (${content.split("\n").length} lines)`;
      }

      const normalizedPath = memPath.startsWith("/memories/") ? memPath : `/memories/${memPath}`;
      const { data: existing } = await svc.from("ai_project_memories")
        .select("id")
        .eq("user_id", userId)
        .eq("path", normalizedPath)
        .maybeSingle();

      if (existing) {
        await svc.from("ai_project_memories")
          .update({ content, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await svc.from("ai_project_memories").insert({
          ai_project_id: aiProjectId || null,
          user_id: userId,
          organization_id: orgId,
          path: normalizedPath,
          content,
        });
      }

      await embedMemory(svc, normalizedPath, content, userId, orgId, aiProjectId);
      return `Successfully wrote to ${normalizedPath} (${content.split("\n").length} lines)`;
    }

    case "str_replace": {
      if (!memPath || !old_str || !new_str) return "Error: path, old_str, and new_str are required.";
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id, content")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        if (!file.content.includes(old_str)) return `old_str not found in ${tp}.`;
        const updated = file.content.replace(old_str, new_str);
        await svc.from("ai_project_shared_memories")
          .update({ content: updated, updated_at: new Date().toISOString(), updated_by: userId })
          .eq("id", file.id);
        const { data: ap } = await svc.from("ai_projects").select("organization_id").eq("id", aiProjectId).single();
        if (ap) await embedSharedMemory(svc, tp, updated, ap.organization_id, aiProjectId, file.id);
        return `Successfully replaced text in ${tp}`;
      }

      let query = svc.from("ai_project_memories")
        .select("id, content")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;
      if (!file.content.includes(old_str)) return `old_str not found in ${memPath}.`;

      const updated = file.content.replace(old_str, new_str);
      await svc.from("ai_project_memories")
        .update({ content: updated, updated_at: new Date().toISOString() })
        .eq("id", file.id);

      await embedMemory(svc, memPath, updated, userId, orgId, aiProjectId);
      return `Successfully replaced text in ${memPath}`;
    }

    case "insert": {
      if (!memPath || !content) return "Error: path and content are required for insert.";
      const insertLine = input.insert_line ?? 0;
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id, content")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        const lines = file.content.split("\n");
        lines.splice(insertLine, 0, content);
        const updated = lines.join("\n");
        await svc.from("ai_project_shared_memories")
          .update({ content: updated, updated_at: new Date().toISOString(), updated_by: userId })
          .eq("id", file.id);
        const { data: ap } = await svc.from("ai_projects").select("organization_id").eq("id", aiProjectId).single();
        if (ap) await embedSharedMemory(svc, tp, updated, ap.organization_id, aiProjectId, file.id);
        return `Successfully inserted text at line ${insertLine} in ${tp}`;
      }

      let query = svc.from("ai_project_memories")
        .select("id, content")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;
      const lines = file.content.split("\n");
      lines.splice(insertLine, 0, content);
      const updated = lines.join("\n");
      await svc.from("ai_project_memories")
        .update({ content: updated, updated_at: new Date().toISOString() })
        .eq("id", file.id);

      await embedMemory(svc, memPath, updated, userId, orgId, aiProjectId);
      return `Successfully inserted text at line ${insertLine} in ${memPath}`;
    }

    case "delete": {
      if (!memPath) return "Error: path is required for delete.";
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        await svc.from("ai_project_shared_memories").delete().eq("id", file.id);
        await svc.from("document_chunks")
          .delete()
          .eq("source_type", "shared_memory")
          .eq("source_id", file.id);
        return `Successfully deleted ${tp}`;
      }

      let query = svc.from("ai_project_memories")
        .select("id")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;

      await svc.from("ai_project_memories").delete().eq("id", file.id);
      await svc.from("document_chunks")
        .delete()
        .eq("source_type", "memory")
        .eq("source_id", file.id);
      return `Successfully deleted ${memPath}`;
    }

    case "rename": {
      if (!memPath || !input.new_path) return "Error: path and new_path are required.";
      if (isTeamMemoryPath(memPath) || isTeamMemoryPath(input.new_path)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const newNorm = normalizeTeamMemoryPath(input.new_path);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        await svc.from("ai_project_shared_memories")
          .update({ path: newNorm, updated_at: new Date().toISOString(), updated_by: userId })
          .eq("id", file.id);
        return `Successfully renamed ${tp} to ${newNorm}`;
      }

      const newNorm = input.new_path.startsWith("/memories/") ? input.new_path : `/memories/${input.new_path}`;
      let query = svc.from("ai_project_memories")
        .select("id")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;
      await svc.from("ai_project_memories")
        .update({ path: newNorm, updated_at: new Date().toISOString() })
        .eq("id", file.id);
      return `Successfully renamed ${memPath} to ${newNorm}`;
    }

    default:
      return `Unknown memory command: ${command}`;
  }
}

async function embedMemory(
  svc: any, path: string, content: string,
  userId: string, orgId: string, aiProjectId: string | null,
): Promise<void> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey || content.length < 20) return;

  try {
    const { data: mem } = await svc.from("ai_project_memories")
      .select("id")
      .eq("user_id", userId)
      .eq("path", path)
      .single();
    if (!mem) return;

    // Delete old chunks for this memory
    await svc.from("document_chunks")
      .delete()
      .eq("source_type", "memory")
      .eq("source_id", mem.id);

    const textToEmbed = `[Memoria: ${path}] ${content}`;
    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: textToEmbed.replace(/\n+/g, " ").trim().substring(0, 8000), model: "text-embedding-3-small", dimensions: 1536 }),
    });

    if (!embResp.ok) return;
    const embData = await embResp.json();
    const embedding = embData.data[0].embedding;

    await svc.from("document_chunks").insert({
      organization_id: orgId,
      client_id: null,
      project_id: null,
      source_type: "memory",
      source_id: mem.id,
      content: textToEmbed.substring(0, 4000),
      metadata: { path, ai_project_id: aiProjectId, user_id: userId },
      embedding: JSON.stringify(embedding),
      token_count: Math.ceil(textToEmbed.length / 3.5),
    });
    console.log(`Embedded memory: ${path}`);
  } catch (e) {
    console.error("Memory embedding failed (non-blocking):", e);
  }
}

async function embedSharedMemory(
  svc: any, path: string, content: string,
  orgId: string, aiProjectId: string, rowId: string,
): Promise<void> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey || content.length < 20) return;

  try {
    await svc.from("document_chunks")
      .delete()
      .eq("source_type", "shared_memory")
      .eq("source_id", rowId);

    const textToEmbed = `[Memoria equipo: ${path}] ${content}`;
    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: textToEmbed.replace(/\n+/g, " ").trim().substring(0, 8000), model: "text-embedding-3-small", dimensions: 1536 }),
    });

    if (!embResp.ok) return;
    const embData = await embResp.json();
    const embedding = embData.data[0].embedding;

    await svc.from("document_chunks").insert({
      organization_id: orgId,
      client_id: null,
      project_id: null,
      source_type: "shared_memory",
      source_id: rowId,
      content: textToEmbed.substring(0, 4000),
      metadata: { path, ai_project_id: aiProjectId },
      embedding: JSON.stringify(embedding),
      token_count: Math.ceil(textToEmbed.length / 3.5),
    });
    console.log(`Embedded shared memory: ${path}`);
  } catch (e) {
    console.error("Shared memory embedding failed (non-blocking):", e);
  }
}

// ─── Claude (Anthropic) handler ───
async function handleClaudeChat(
  apiKey: string, systemPrompt: string, userMessages: any[],
  supabase: any, userId: string, orgId: string, aiProjectId: string | null,
): Promise<Response> {
  let anthropicMsgs = toAnthropicMessages(userMessages);
  const MAX_ROUNDS = 8;
  const createdArtifacts: { id: string; title: string; content_type: string }[] = [];

  // Build tools array: custom tools + memory tool (as custom tool definition for compatibility)
  const memoryToolDef = {
    name: "memory",
    description: "Memoria persistente: /memories/... (personal del usuario) y /team/... (compartida con el proyecto de IA, requiere proyecto activo). COMANDOS: view, create, str_replace, insert, delete, rename.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["view", "create", "str_replace", "insert", "delete", "rename"], description: "Comando a ejecutar" },
        path: { type: "string", description: "Ruta: /memories/archivo.md (personal) o /team/archivo.md (equipo)" },
        content: { type: "string", description: "Contenido del archivo (para create/insert)" },
        old_str: { type: "string", description: "Texto a reemplazar (para str_replace)" },
        new_str: { type: "string", description: "Nuevo texto (para str_replace)" },
        new_path: { type: "string", description: "Nueva ruta (para rename)" },
        insert_line: { type: "number", description: "Numero de linea donde insertar (para insert)" },
        view_range: { type: "array", items: { type: "number" }, description: "Rango de lineas [inicio, fin] (para view)" },
      },
      required: ["command"],
    },
  };
  const allTools: any[] = [
    ...anthropicTools,
    memoryToolDef,
  ];

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
        tools: isLastChance ? undefined : allTools,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
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
        let result: any;

        if (tu.name === "memory") {
          console.log(`Memory Tool: ${tu.input?.command} ${tu.input?.path || ""}`);
          const memResult = await handleMemoryToolCall(tu.input || {}, userId, orgId, aiProjectId);
          result = memResult;
        } else if (tu.name === "create_artifact") {
          console.log(`Artifact Tool: ${tu.input?.title}`);
          result = await handleCreateArtifact(tu.input || {}, userId, orgId, aiProjectId);
          try {
            const parsed = JSON.parse(result);
            if (parsed.artifact_id) {
              createdArtifacts.push({ id: parsed.artifact_id, title: parsed.title, content_type: parsed.content_type || "markdown" });
            }
          } catch {}
        } else {
          console.log(`Tool [Claude]: ${tu.name}`, tu.input);
          result = await executeTool(tu.name, tu.input || {}, supabase, userId, orgId);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
      anthropicMsgs.push({ role: "user", content: toolResults });
      continue;
    }

    let textContent = contentBlocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    if (createdArtifacts.length > 0) {
      const markers = createdArtifacts.map(
        (a) => `[artifact:${a.id}|${a.title}|${a.content_type}]`
      ).join("\n");
      textContent = textContent + "\n\n" + markers;
    }

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
