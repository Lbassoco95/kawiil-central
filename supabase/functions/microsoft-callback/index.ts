import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(
        `<html><body><script>window.close(); window.opener?.postMessage({type:'microsoft-auth-error',error:'${error}'},'*');</script><p>Error: ${error}. Puedes cerrar esta ventana.</p></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    if (!code || !userId) {
      return new Response("Missing code or state", { status: 400 });
    }

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/microsoft-callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Token exchange failed:", tokenData);
      return new Response(
        `<html><body><script>window.opener?.postMessage({type:'microsoft-auth-error',error:'token_exchange_failed'},'*');window.close();</script><p>Error al obtener token. Puedes cerrar esta ventana.</p></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Upsert tokens
    const { error: dbError } = await supabase
      .from("microsoft_tokens")
      .upsert(
        {
          user_id: userId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
          scope: tokenData.scope,
        },
        { onConflict: "user_id" }
      );

    if (dbError) {
      console.error("DB error:", dbError);
      return new Response(
        `<html><body><script>window.opener?.postMessage({type:'microsoft-auth-error',error:'db_error'},'*');window.close();</script><p>Error al guardar. Puedes cerrar esta ventana.</p></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response(
      `<html><body><script>window.opener?.postMessage({type:'microsoft-auth-success'},'*');window.close();</script><p>¡Conectado! Puedes cerrar esta ventana.</p></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    console.error("Callback error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
