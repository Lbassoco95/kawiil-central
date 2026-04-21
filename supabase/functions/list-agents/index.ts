import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * list-agents
 * -----------
 * Devuelve la lista de agentes consultables disponibles para delegar una
 * tarea desde el chat de /asistente. Consumida por <DelegateToAgentDialog>.
 *
 * Modos:
 *   - "instance": cuando la delegación ocurre en contexto de un cliente.
 *       Se devuelven las filas de client_agents del cliente (instancias)
 *       con el template anidado desde agent_registry.
 *   - "template": cuando no hay cliente en contexto.
 *       Se devuelven directamente los templates consultables activos.
 *
 * Diseño (Bloque B1.6 del plan v6):
 *   - verify_jwt=true en supabase/config.toml.
 *   - `user_id` se extrae del JWT (anti-spoofing).
 *   - agent_registry vive en AGENT_ORG_ID (00000000-0000-0000-0000-000000000001);
 *     los usuarios NO tienen RLS para leerlo → requerimos service_role.
 *   - client_agents sí tiene RLS por organization_id; igualmente leemos con
 *     service_role porque necesitamos hacer JOIN al template en la org global.
 *     La autorización se hace antes, validando ownership del cliente contra
 *     el organization_id del usuario.
 *   - Sin llamadas externas: solo DB, no hay AbortController.
 *
 * Contrato de respuesta:
 *   {
 *     "mode": "instance" | "template",
 *     "agents": [
 *       {
 *         // solo en mode="instance":
 *         "instance_id": "uuid",
 *         "instance_status": "active" | "paused" | "archived",
 *         // siempre:
 *         "template_id": "uuid",
 *         "name": string,
 *         "display_name": string,
 *         "description": string | null,
 *         "role": string,
 *         "capabilities": string[],
 *         "color": string
 *       }
 *     ]
 *   }
 *
 * Orden: alfabético por display_name.
 *
 * Secrets requeridos:
 *   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-inyectados).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_AGENT_COLOR = "#4da6ff";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ListAgentsBody {
  client_id?: unknown;
}

interface TemplateRow {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  role: string;
  capabilities: unknown;
  config: unknown;
}

interface InstanceRow {
  id: string;
  status: string;
  template: TemplateRow | TemplateRow[] | null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function extractColor(config: unknown): string {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const c = (config as Record<string, unknown>).color;
    if (typeof c === "string" && c.length > 0) return c;
  }
  return DEFAULT_AGENT_COLOR;
}

function normalizeTemplate(t: TemplateRow | TemplateRow[] | null): TemplateRow | null {
  // El join de PostgREST puede devolver objeto o array según cardinalidad
  // inferida. Normalizamos a objeto o null.
  if (!t) return null;
  if (Array.isArray(t)) return t[0] ?? null;
  return t;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    // Cliente con JWT del usuario: respeta RLS y permite auth.getUser() con
    // el contexto real del usuario (convención del repo: anon + Authorization).
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "Invalid or expired JWT" }, 401);
    }

    const userId = userData.user.id;

    // Cliente admin para lookups que bypasean RLS: profile del usuario y
    // agent_registry (que vive en la org global AGENT_ORG_ID).
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: ListAgentsBody;
    try {
      body = (await req.json()) as ListAgentsBody;
    } catch {
      // Body opcional: si no es JSON válido, tratamos como sin client_id.
      body = {};
    }

    const clientIdRaw = body?.client_id;
    const clientId =
      typeof clientIdRaw === "string" && clientIdRaw.length > 0 ? clientIdRaw : null;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile) {
      console.error("list-agents: user profile not found", {
        userId,
        err: profileError?.message,
      });
      return jsonResponse({ error: "User profile not found" }, 403);
    }

    // =========================================================================
    // CASO B — sin client_id: devolver templates consultables activos.
    // =========================================================================
    if (!clientId) {
      const { data, error } = await supabaseAdmin
        .from("agent_registry")
        .select("id, name, display_name, description, role, capabilities, config")
        .eq("kind", "consultable")
        .eq("status", "idle")
        .order("display_name", { ascending: true });

      if (error) {
        console.error("list-agents: template query failed", { err: error.message });
        return jsonResponse({ error: "Failed to load agents" }, 500);
      }

      const agents = (data ?? []).map((row) => ({
        template_id: row.id,
        name: row.name,
        display_name: row.display_name,
        description: row.description,
        role: row.role,
        capabilities: toStringArray(row.capabilities),
        color: extractColor(row.config),
      }));

      return jsonResponse({ mode: "template", agents }, 200);
    }

    // =========================================================================
    // CASO A — con client_id: validar ownership y devolver instancias.
    // =========================================================================

    // Validar ownership con el cliente autenticado (respeta RLS de clients).
    // Si el usuario no pertenece a la org del cliente, RLS devolverá null.
    const { data: client, error: clientError } = await supabaseUser
      .from("clients")
      .select("id, organization_id")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError) {
      console.error("list-agents: client lookup failed", {
        clientId,
        userId,
        err: clientError.message,
      });
      return jsonResponse({ error: "Failed to validate client" }, 500);
    }
    if (!client) {
      return jsonResponse({ error: "Client not found" }, 404);
    }
    // Defensa en profundidad: comparar orgs aunque RLS ya lo haga.
    if (client.organization_id !== profile.organization_id) {
      console.error("list-agents: org mismatch between user and client", {
        clientId,
        userOrg: profile.organization_id,
        clientOrg: client.organization_id,
      });
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    // Leer client_agents con JOIN a agent_registry (org global) via service_role.
    // Filtramos en SQL solo por client_id; los filtros de template (kind='consultable',
    // status='idle') se aplican en memoria porque el filtro `.eq('template.kind', …)`
    // en nested selects de PostgREST no siempre excluye filas, solo deja el embed null.
    const { data, error } = await supabaseAdmin
      .from("client_agents")
      .select(
        `
        id,
        status,
        template:agent_registry!template_id (
          id,
          name,
          display_name,
          description,
          role,
          kind,
          status,
          capabilities,
          config
        )
      `,
      )
      .eq("client_id", clientId);

    if (error) {
      console.error("list-agents: instance query failed", {
        clientId,
        err: error.message,
      });
      return jsonResponse({ error: "Failed to load client agents" }, 500);
    }

    const agents = ((data as InstanceRow[] | null) ?? [])
      .map((row) => {
        const template = normalizeTemplate(row.template) as
          | (TemplateRow & { kind?: string; status?: string })
          | null;
        if (!template) return null;
        if (template.kind !== "consultable") return null;
        if (template.status !== "idle") return null;
        return {
          instance_id: row.id,
          instance_status: row.status,
          template_id: template.id,
          name: template.name,
          display_name: template.display_name,
          description: template.description,
          role: template.role,
          capabilities: toStringArray(template.capabilities),
          color: extractColor(template.config),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "es"));

    return jsonResponse({ mode: "instance", agents }, 200);
  } catch (err) {
    const e = err as { message?: string };
    console.error("list-agents: unexpected error", e?.message || err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
