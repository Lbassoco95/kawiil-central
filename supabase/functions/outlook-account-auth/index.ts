import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAdminConsentUrl,
  normalizeTenant,
  OUTLOOK_DELEGATED_SCOPES,
  tenantFromEmail,
} from "../_shared/microsoftConsent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inicia OAuth para conectar una cuenta ADICIONAL de Outlook/Microsoft (se guarda
// en linked_accounts, aparte del buzón principal que vive en microsoft_tokens).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")?.trim();
    // Cuentas ADICIONALES: usamos 'common' por defecto para permitir cualquier
    // organización Microsoft (requiere que la app de Azure sea multitenant).
    // Se puede fijar un tenant específico con MICROSOFT_LINKED_TENANT_ID.
    const tenantId = Deno.env.get("MICROSOFT_LINKED_TENANT_ID")?.trim() || "common";
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/outlook-account-callback`;
    if (!clientId) {
      return new Response(JSON.stringify({ error: "Microsoft credentials not configured" }), { status: 500, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({})) as { action?: unknown; email?: unknown; tenant?: unknown };
    if (body.action === "admin-consent-url") {
      const tenant = tenantFromEmail(typeof body.email === "string" ? body.email : null) ||
        normalizeTenant(typeof body.tenant === "string" ? body.tenant : null) ||
        "organizations";
      const url = buildAdminConsentUrl({ tenant, clientId, redirectUri });
      return new Response(JSON.stringify({ url, tenant }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const scopes = OUTLOOK_DELEGATED_SCOPES.join(" ");

    // prompt=consent (no select_account): fuerza a Microsoft a pedir el consentimiento
    // de los scopes NUEVOS (Mail.*). Con select_account, una cuenta ya consentida recibe
    // el token con los permisos viejos (solo calendario) y el correo sigue en 403.
    // select_account además está implicado en errores AADSTS165000 (cookies del picker).
    const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: scopes,
        response_mode: "query",
        state: user.id,
        prompt: "consent",
      }).toString();

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in outlook-account-auth:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
