import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * dispatch-to-agent
 * -----------------
 * Proxy autenticado entre Kawiil OS y la VM kawiil-agents.
 *
 * Flujo:
 *   Frontend ──(JWT de usuario)──▶ esta edge function
 *                                    │
 *                                    ├── valida JWT (auth.getUser)
 *                                    ├── resuelve organization_id via profiles
 *                                    ├── valida existencia del agente en agent_registry
 *                                    └── POST http://VM/api/tasks/dispatch
 *                                           con X-Kawiil-Dispatch-Token
 *
 * Diseño (Bloque B1.2 del plan v6):
 *   - `user_id` se extrae del JWT, nunca del body → anti-spoofing.
 *   - `agent_id` se valida contra agent_registry (service_role bypass RLS).
 *     Los agentes viven en una organización global AGENT_ORG_ID, por lo que
 *     no se exige match de org con el usuario (cualquier usuario del despacho
 *     puede delegar). Si a futuro se requiere gating por rol, va aquí.
 *   - Timeout de 30s vía AbortController.
 *   - verify_jwt=true en supabase/config.toml.
 *
 * Secrets requeridos:
 *   - KAWIIL_DISPATCH_TOKEN: token compartido con la VM (header X-Kawiil-Dispatch-Token).
 *   - VM_DISPATCH_URL: URL completa al endpoint /api/tasks/dispatch de la VM.
 *   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-inyectados).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const KAWIIL_DISPATCH_TOKEN = Deno.env.get("KAWIIL_DISPATCH_TOKEN");
const VM_DISPATCH_URL = Deno.env.get("VM_DISPATCH_URL");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VM_TIMEOUT_MS = 30_000;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * input_context (objeto reenviado tal cual a la VM kawiil-agents) puede incluir p. ej.:
 * - conversation_id: hilo del chat
 * - ai_project_id: proyecto IA activo (mismo id que en chat) para alinear RAG / memorias
 * - include_conversation_excerpt: si true, la VM puede solicitar a Supabase un extracto de mensajes memorias
 * - previous_task_id: tarea de agente previa (segunda búsqueda / seguimiento)
 * - follow_up_kind: "retry" | "continuation" (metadata opcional)
 * - knowledge_supabase_ref_count: número de refs de documentos de proyecto (bucket `documents`) incluidas en `attachment_refs`
 * - knowledge_dropbox_documents: [{ document_id, name, external_path }] — enlaces a Dropbox (sin archivo en Storage)
 * La edge no interpreta el contenido; solo valida y reenvía.
 */
interface DispatchBody {
  title?: unknown;
  agent_id?: unknown;
  description?: unknown;
  attachment_refs?: unknown;
  client_id?: unknown;
  project_id?: unknown;
  task_type?: unknown;
  priority?: unknown;
  instructions?: unknown;
  input_context?: unknown;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!KAWIIL_DISPATCH_TOKEN || !VM_DISPATCH_URL) {
    console.error(
      "dispatch-to-agent: missing required secrets",
      { hasToken: !!KAWIIL_DISPATCH_TOKEN, hasUrl: !!VM_DISPATCH_URL },
    );
    return jsonResponse({ error: "Dispatch service not configured" }, 503);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    // Cliente con JWT del usuario para resolver el user desde el token.
    // Usa ANON_KEY (convención del repo: anon + Authorization header para
    // que RLS y auth.getUser operen con el contexto del usuario).
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "Invalid or expired JWT" }, 401);
    }

    const userId = userData.user.id;

    // Cliente admin (service_role) para lookups internos que bypasean RLS:
    // perfil del usuario y existencia del agente.
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: DispatchBody;
    try {
      body = (await req.json()) as DispatchBody;
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const {
      title,
      agent_id,
      description,
      attachment_refs,
      client_id,
      project_id,
      task_type,
      priority,
      instructions,
      input_context,
    } = body;

    if (!title || typeof title !== "string") {
      return jsonResponse({ error: "Missing or invalid field: title" }, 400);
    }
    if (!agent_id || typeof agent_id !== "string") {
      return jsonResponse({ error: "Missing or invalid field: agent_id" }, 400);
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile) {
      console.error("dispatch-to-agent: user profile not found", {
        userId,
        err: profileError?.message,
      });
      return jsonResponse({ error: "User profile not found" }, 403);
    }

    // Validar existencia del agente. Los agentes de VM viven en una organización
    // global (AGENT_ORG_ID = 00000000-0000-0000-0000-000000000001), por eso no
    // exigimos match con la org del usuario. Si en el futuro se quiere restringir
    // por rol/permiso, agregar la validación aquí.
    const { data: agent, error: agentError } = await supabaseAdmin
      .from("agent_registry")
      .select("id, name, organization_id")
      .eq("id", agent_id)
      .maybeSingle();

    if (agentError) {
      console.error("dispatch-to-agent: agent lookup failed", {
        agent_id,
        err: agentError.message,
      });
      return jsonResponse({ error: "Failed to validate agent" }, 500);
    }
    if (!agent) {
      return jsonResponse({ error: `Agent with id ${agent_id} not found` }, 404);
    }

    const vmPayload: Record<string, unknown> = {
      title,
      agent_id,
      user_id: userId,
      description: typeof description === "string" ? description : "",
      task_type: typeof task_type === "string" ? task_type : "manual",
      priority: typeof priority === "string" ? priority : "normal",
      instructions: typeof instructions === "string" ? instructions : "",
    };

    if (typeof client_id === "string" && client_id) vmPayload.client_id = client_id;
    if (typeof project_id === "string" && project_id) vmPayload.project_id = project_id;
    if (input_context && typeof input_context === "object") {
      vmPayload.input_context = input_context;
    }
    if (Array.isArray(attachment_refs)) {
      vmPayload.attachment_refs = attachment_refs;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VM_TIMEOUT_MS);

    let vmResponse: Response;
    try {
      vmResponse = await fetch(VM_DISPATCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kawiil-Dispatch-Token": KAWIIL_DISPATCH_TOKEN,
        },
        body: JSON.stringify(vmPayload),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      const err = fetchError as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        console.error("dispatch-to-agent: VM request timeout", { agent_id, userId });
        return jsonResponse({ error: "VM did not respond in time" }, 504);
      }
      console.error("dispatch-to-agent: VM fetch failed", {
        agent_id,
        userId,
        err: err?.message,
      });
      return jsonResponse({ error: "Failed to reach VM" }, 502);
    }
    clearTimeout(timeoutId);

    const vmBody = await vmResponse.text();

    if (!vmResponse.ok) {
      console.error("dispatch-to-agent: VM returned non-2xx", {
        status: vmResponse.status,
        body: vmBody.slice(0, 500),
      });
      return new Response(vmBody, {
        status: vmResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(vmBody, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const e = err as { message?: string };
    console.error("dispatch-to-agent: unexpected error", e?.message || err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
