// sw-folio — genera un folio KAW-AAAA-XXXX consecutivo y atómico usando la RPC
// public.next_switchboard_folio(anio) (lock de fila en folio_sequence → 0
// duplicados aun con llamadas concurrentes).
import { corsHeaders, jsonResponse, checkWebhookAuth } from "../_shared/switchboard-http.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// El año se pasa explícito (o se usa el año UTC actual). La RPC es la fuente de
// verdad del consecutivo; aquí no se calcula nada que compita entre requests.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauth = checkWebhookAuth(req);
  if (unauth) return unauth;

  try {
    const body = await req.json().catch(() => ({}));
    const anio =
      typeof body?.anio === "number" ? body.anio : new Date().getUTCFullYear();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin.rpc("next_switchboard_folio", { p_anio: anio });
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ folio: data });
  } catch (e) {
    console.error("sw-folio error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
