// sw-extension-target — resuelve una extensión (o el nombre de una persona) al
// endpoint SIP interno de su softphone, para el SIP REFER directo de ElevenLabs.
// El endpoint NUNCA se expone al llamante (igual que el celular del G4).
//
// Entradas: { extension?, nombre?, organization_id? }
//   - extension → busca esa extensión activa.
//   - nombre    → busca en el directorio; si hay 1, conecta; si hay varios,
//                 devuelve needs_disambiguation con opciones (extensiones).
import { corsHeaders, jsonResponse, checkWebhookAuth } from "../_shared/switchboard-http.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { filterDirectoryByName, type DirectoryEntry } from "../_shared/conmutador.ts";

const DEFAULT_ORG = "a0000000-0000-0000-0000-000000000001";

interface DirRow extends DirectoryEntry {
  user_id: string;
  sip_endpoint: string | null;
  is_active: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauth = checkWebhookAuth(req);
  if (unauth) return unauth;

  try {
    const body = await req.json().catch(() => ({}));
    const org: string = typeof body.organization_id === "string" ? body.organization_id : DEFAULT_ORG;
    const extension: string | null =
      body.extension != null ? String(body.extension).trim() : null;
    const nombre: string | null = typeof body.nombre === "string" ? body.nombre.trim() : null;

    if (!extension && !nombre) {
      return jsonResponse({ error: "Indica extension o nombre" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Por extensión (camino directo) ---
    if (extension) {
      const { data, error } = await admin
        .from("switchboard_extensions")
        .select("user_id, extension, sip_endpoint, is_active")
        .eq("organization_id", org)
        .eq("extension", extension)
        .eq("is_active", true)
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!data) return jsonResponse({ error: "Extensión no encontrada", extension }, 404);
      if (!data.sip_endpoint) {
        return jsonResponse({ error: "Extensión sin endpoint SIP", extension }, 409);
      }
      return jsonResponse({
        sip_endpoint: data.sip_endpoint,
        user_id: data.user_id,
        extension: data.extension,
        source: "extension",
      });
    }

    // --- Por nombre (con desambiguación) ---
    const { data: dir, error: dirErr } = await admin
      .from("v_switchboard_directory")
      .select("user_id, extension, nombre, sip_endpoint, is_active")
      .eq("organization_id", org)
      .eq("is_active", true);
    if (dirErr) return jsonResponse({ error: dirErr.message }, 500);

    const matches = filterDirectoryByName((dir ?? []) as DirRow[], nombre as string);

    if (matches.length === 0) {
      return jsonResponse({ error: "Persona no encontrada en el directorio", nombre }, 404);
    }
    if (matches.length > 1) {
      return jsonResponse({
        needs_disambiguation: true,
        opciones: matches.map((m) => ({ nombre: m.nombre, extension: m.extension })),
      });
    }
    const only = matches[0];
    if (!only.sip_endpoint) {
      return jsonResponse({ error: "La persona no tiene endpoint SIP", nombre }, 409);
    }
    return jsonResponse({
      sip_endpoint: only.sip_endpoint,
      user_id: only.user_id,
      extension: only.extension,
      nombre: only.nombre,
      source: "nombre",
    });
  } catch (e) {
    console.error("sw-extension-target error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
