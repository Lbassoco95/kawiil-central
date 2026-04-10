import { createClient } from "npm:@supabase/supabase-js@2";

const postMessageOrigin = Deno.env.get("APP_ORIGIN")?.trim() || "*";

function renderPage(status: "success" | "error", message: string, detail?: string) {
  const isSuccess = status === "success";
  const icon = isSuccess
    ? `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kawiil — Slack</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc;
    }
    .card {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 16px;
      padding: 48px 40px;
      text-align: center;
      max-width: 420px;
      width: 90%;
    }
    .icon { margin-bottom: 24px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
    .detail { color: #94a3b8; font-size: 14px; margin-top: 8px; }
    .hint { margin-top: 24px; color: #64748b; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${message}</h1>
    ${detail ? `<p class="detail">${detail}</p>` : ""}
    <p class="hint">Esta ventana se cerrará automáticamente…</p>
  </div>
  <script>
    setTimeout(function() { window.close(); }, 2500);
  </script>
</body>
</html>`;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");

    if (errParam) {
      return new Response(
        `<html><body>
          <script>window.opener?.postMessage({type:'slack-auth-error',error:${JSON.stringify(errParam)}}, ${JSON.stringify(postMessageOrigin)});</script>
          ${renderPage("error", "Error de conexión con Slack", errParam)}
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    if (!code || !userId) {
      return new Response(renderPage("error", "Solicitud inválida", "Faltan parámetros."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const clientId = Deno.env.get("SLACK_CLIENT_ID")!.trim();
    const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET")!.trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
    const redirectUri = `${supabaseUrl}/functions/v1/slack-user-callback`;

    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.ok || !tokenData.authed_user?.access_token) {
      console.error("Slack oauth.v2.access failed:", tokenData);
      return new Response(
        `<html><body>
          <script>window.opener?.postMessage({type:'slack-auth-error',error:'token_exchange_failed'}, ${JSON.stringify(postMessageOrigin)});</script>
          ${renderPage("error", "No se pudo completar Slack", tokenData.error || "Error de token")}
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const accessToken = tokenData.authed_user.access_token as string;
    const slackUserId = tokenData.authed_user.id as string;
    const slackTeamId = tokenData.team?.id as string;

    if (!slackTeamId) {
      return new Response(
        `<html><body>
          <script>window.opener?.postMessage({type:'slack-auth-error',error:'no_team'}, ${JSON.stringify(postMessageOrigin)});</script>
          ${renderPage("error", "Sin workspace", "Slack no devolvió un equipo.")}
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profErr || !profile?.organization_id) {
      console.error("Profile lookup:", profErr);
      return new Response(
        `<html><body>
          <script>window.opener?.postMessage({type:'slack-auth-error',error:'no_profile'}, ${JSON.stringify(postMessageOrigin)});</script>
          ${renderPage("error", "Perfil no encontrado", "No hay organización asociada.")}
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const expiresIn = tokenData.authed_user.expires_in as number | undefined;
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const { error: dbError } = await supabase.from("user_slack_connections").upsert(
      {
        user_id: userId,
        organization_id: profile.organization_id,
        slack_team_id: slackTeamId,
        slack_user_id: slackUserId,
        access_token: accessToken,
        refresh_token: null,
        token_expires_at: tokenExpiresAt,
        scopes: tokenData.authed_user.scope as string || null,
      },
      { onConflict: "user_id,slack_team_id" },
    );

    if (dbError) {
      console.error("user_slack_connections upsert:", dbError);
      return new Response(
        `<html><body>
          <script>window.opener?.postMessage({type:'slack-auth-error',error:'db_error'}, ${JSON.stringify(postMessageOrigin)});</script>
          ${renderPage("error", "Error al guardar", "No se pudieron guardar las credenciales.")}
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    return new Response(
      `<html><body>
        <script>window.opener?.postMessage({type:'slack-auth-success'}, ${JSON.stringify(postMessageOrigin)});</script>
        ${renderPage("success", "Slack conectado", "Ya puedes usar Comunicación en Kawiil.")}
      </body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    console.error("slack-user-callback:", err);
    return new Response(renderPage("error", "Error interno", "Intenta de nuevo."), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});
