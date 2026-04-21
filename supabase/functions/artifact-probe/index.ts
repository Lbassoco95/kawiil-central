// =============================================================
// artifact-probe
//
// Diagnóstico y fallback para `openArtifactFromChat` del Asistente IA.
// Se invoca cuando el SELECT directo en `ai_artifacts` devuelve 0 filas,
// para determinar si la fila realmente no existe o fue recortada por RLS.
//
// Regla de acceso:
//   - Se usa service-role para consultar la fila, pero SOLO se devuelve al
//     cliente si `organization_id` coincide con la org del usuario autenticado
//     (por `profiles.organization_id`). En caso contrario solo se reporta
//     `reason: "wrong_org"` sin filtrar datos privados.
//
// Respuesta:
//   {
//     reason: "ok" | "not_found" | "rls_mismatch_user" | "wrong_org",
//     exists_in_org: boolean,
//     owner_user_id: string | null,
//     ai_project_id: string | null,
//     created_at: string | null,
//     has_outputs: boolean,
//     artifact?: AiArtifact   // solo si reason === "rls_mismatch_user" o "ok"
//   }
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "No autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "No autorizado" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => null) as { id?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id || !UUID_RE.test(id)) {
      return json({ error: "id inválido" }, 400);
    }

    const svc = createClient(supabaseUrl, serviceKey);

    // Resolver la organización del usuario para acotar qué filas puede ver.
    const { data: profile, error: profileErr } = await svc
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileErr) {
      console.error("artifact-probe: error leyendo profile", profileErr);
      return json({ error: "No se pudo resolver la organización del usuario" }, 500);
    }
    const userOrgId = profile?.organization_id ?? null;

    const { data: row, error: rowErr } = await svc
      .from("ai_artifacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (rowErr) {
      console.error("artifact-probe: error consultando ai_artifacts", rowErr);
      return json({ error: "Error consultando artefacto" }, 500);
    }

    if (!row) {
      return json({
        reason: "not_found",
        exists_in_org: false,
        owner_user_id: null,
        ai_project_id: null,
        created_at: null,
        has_outputs: false,
      });
    }

    const rowOrgId = row.organization_id as string | null;
    const rowOwner = row.user_id as string | null;
    const hasOutputs = Array.isArray(row.output_formats) && row.output_formats.length > 0;

    if (!userOrgId || rowOrgId !== userOrgId) {
      // El artefacto existe pero está en otra org: NO devolver datos sensibles.
      console.warn("artifact-probe: wrong_org", {
        id,
        userId,
        userOrgId,
        rowOrgId,
      });
      return json({
        reason: "wrong_org",
        exists_in_org: false,
        owner_user_id: null,
        ai_project_id: null,
        created_at: null,
        has_outputs: false,
      });
    }

    if (rowOwner === userId) {
      // Raro: el SELECT directo debería haber funcionado. Probablemente un timing
      // issue de RLS o de caché; devolvemos la fila de todos modos.
      return json({
        reason: "ok",
        exists_in_org: true,
        owner_user_id: rowOwner,
        ai_project_id: row.ai_project_id ?? null,
        created_at: row.created_at ?? null,
        has_outputs: hasOutputs,
        artifact: row,
      });
    }

    // Mismo org, distinto owner: permitimos ver el artefacto (read-only) para
    // mantener continuidad del chat cuando varios miembros colaboran, pero NO
    // exponemos la fila fuera del org (ya validado arriba).
    return json({
      reason: "rls_mismatch_user",
      exists_in_org: true,
      owner_user_id: rowOwner,
      ai_project_id: row.ai_project_id ?? null,
      created_at: row.created_at ?? null,
      has_outputs: hasOutputs,
      artifact: row,
    });
  } catch (err) {
    console.error("artifact-probe unexpected error:", err);
    const message = err instanceof Error ? err.message : "Error desconocido";
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
