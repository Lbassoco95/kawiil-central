import { createClient } from "npm:@supabase/supabase-js@2";

const postMessageOrigin = "*";

function renderPage(status: "success" | "error", message: string, detail?: string) {
  const isSuccess = status === "success";
  const icon = isSuccess
    ? `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Kawiil - Google</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f8fafc; }
  .card { background: rgba(30,41,59,0.8); backdrop-filter: blur(12px); border: 1px solid rgba(99,102,241,0.2); border-radius: 16px; padding: 48px 40px; text-align: center; max-width: 420px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.4); }
  .icon { margin-bottom: 24px; } h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
  .detail { color: #94a3b8; font-size: 14px; margin-top: 8px; } .hint { margin-top: 24px; color: #64748b; font-size: 13px; }
  .brand { margin-top: 32px; font-size: 12px; color: #475569; letter-spacing: 1px; text-transform: uppercase; }
</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1>${message}</h1>${detail ? `<p class="detail">${detail}</p>` : ""}
<p class="hint">Esta ventana se cerrará automáticamente...</p><p class="brand">Kawiil Central</p></div>
<script>setTimeout(function(){window.close();},3000);</script></body></html>`;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(
        `<html><head></head><body><script>window.opener?.postMessage({type:'google-auth-error',error:'${error}'},'${postMessageOrigin}');</script>${renderPage("error", "Error de conexión", error)}</body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    if (!code || !userId) {
      return new Response(renderPage("error", "Solicitud inválida", "Faltan parámetros requeridos."), { status: 400, headers: { "Content-Type": "text/html" } });
    }

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!.trim();
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!.trim();
    const redirectUri = `${Deno.env.get("SUPABASE_URL")!.trim()}/functions/v1/google-callback`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Google token exchange failed:", tokenData);
      return new Response(
        `<html><head></head><body><script>window.opener?.postMessage({type:'google-auth-error',error:'token_exchange_failed'},'${postMessageOrigin}');</script>${renderPage("error", "Error al obtener token", "No se pudo completar la autenticación con Google.")}</body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }

    // Identidad de la cuenta conectada
    let email: string | null = null;
    let providerAccountId: string | null = null;
    let displayName: string | null = null;
    try {
      const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (infoRes.ok) {
        const info = await infoRes.json();
        email = info.email ?? null;
        providerAccountId = info.sub ?? null;
        displayName = info.name ?? null;
      }
    } catch (_) { /* la identidad es opcional */ }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();

    const { error: dbError } = await supabase
      .from("linked_accounts")
      .upsert(
        {
          user_id: userId,
          provider: "google",
          email,
          display_name: displayName,
          provider_account_id: providerAccountId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
          token_expires_at: expiresAt,
          scope: tokenData.scope ?? null,
          status: "connected",
          last_error: null,
        },
        { onConflict: "user_id,provider,email" },
      );

    if (dbError) {
      console.error("DB error:", dbError);
      return new Response(
        `<html><head></head><body><script>window.opener?.postMessage({type:'google-auth-error',error:'db_error'},'${postMessageOrigin}');</script>${renderPage("error", "Error al guardar", "No se pudieron guardar las credenciales.")}</body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }

    return new Response(
      `<html><head></head><body><script>window.opener?.postMessage({type:'google-auth-success'},'${postMessageOrigin}');</script>${renderPage("success", "¡Google conectado!", "Tu cuenta se vinculó correctamente con Kawiil.")}</body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  } catch (err) {
    console.error("Google callback error:", err);
    return new Response(renderPage("error", "Error interno", "Ocurrió un error inesperado. Intenta de nuevo."), { status: 500, headers: { "Content-Type": "text/html" } });
  }
});
