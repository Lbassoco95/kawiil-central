// sw-transfer-target — dada la célula, devuelve el celular del G4 vigente leyendo
// la vista v_g4_por_celula (que resuelve el responsable desde el catálogo de RH,
// con override opcional de switchboard_config). Este número alimenta el SIP REFER
// de ElevenLabs y NUNCA se expone al llamante.
import { corsHeaders, jsonResponse, checkWebhookAuth } from "../_shared/switchboard-http.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isCelula } from "../_shared/conmutador.ts";

const DEFAULT_ORG = "a0000000-0000-0000-0000-000000000001"; // organización Kawiil

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauth = checkWebhookAuth(req);
  if (unauth) return unauth;

  try {
    const { celula, organization_id } = await req
      .json()
      .catch(() => ({ celula: null, organization_id: null }));
    if (!isCelula(celula)) {
      return jsonResponse({ error: "celula inválida (LIT|CORP|COMP|CONT|PROC)" }, 400);
    }
    const org = typeof organization_id === "string" ? organization_id : DEFAULT_ORG;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin
      .from("v_g4_por_celula")
      .select("g4_id, g4_nombre, g4_telefono, source")
      .eq("organization_id", org)
      .eq("celula", celula)
      .maybeSingle();

    if (error) return jsonResponse({ error: error.message }, 500);
    if (!data || !data.g4_id) {
      return jsonResponse({ error: "Sin G4 configurado para la célula", celula }, 404);
    }
    if (!data.g4_telefono) {
      return jsonResponse(
        { error: "El G4 no tiene teléfono registrado", celula, g4_id: data.g4_id },
        409,
      );
    }

    return jsonResponse({
      target_number: data.g4_telefono,
      g4_id: data.g4_id,
      g4_nombre: data.g4_nombre,
      source: data.source, // 'override' | 'rh'
    });
  } catch (e) {
    console.error("sw-transfer-target error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
