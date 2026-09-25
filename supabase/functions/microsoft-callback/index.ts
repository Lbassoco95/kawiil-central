import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyMicrosoftOAuthError } from "../_shared/microsoftOAuthErrors.ts";
import {
  buildAppReturnUrl,
  parseMicrosoftOAuthState,
  sanitizeReturnPath,
} from "../_shared/microsoftOAuthState.ts";

const postMessageOrigin = "*";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(
  status: "success" | "error",
  message: string,
  detail?: string,
  opts?: { returnUrl?: string; autoClose?: boolean },
) {
  const isSuccess = status === "success";
  const icon = isSuccess
    ? `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

  const returnUrl = opts?.returnUrl;
  const autoClose = opts?.autoClose !== false && !returnUrl;
  const safeReturn = returnUrl ? escapeHtml(returnUrl) : "";
  const returnBlock = returnUrl
    ? `<p style="margin-top:20px"><a href="${safeReturn}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#3b82f6;color:#fff;text-decoration:none;font-size:14px;font-weight:600">Volver a Kawiil Central</a></p>
       <p class="hint">Si el botón no funciona, cierra esta pestaña y abre de nuevo kawiil-central.mx</p>
       <script>setTimeout(function(){ window.location.replace(${JSON.stringify(returnUrl)}); }, 1200);</script>`
    : autoClose
      ? `<p class="hint">Esta ventana se cerrará automáticamente...</p>
         <script>setTimeout(function(){ window.close(); }, 3000);</script>`
      : `<p class="hint">Puedes cerrar esta ventana y volver a Kawiil Central.</p>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kawiil - Microsoft 365</title>
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
      backdrop-filter: blur(12px);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 16px;
      padding: 48px 40px;
      text-align: center;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.4);
      animation: fadeIn 0.4s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .icon { margin-bottom: 24px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
    .detail { color: #94a3b8; font-size: 14px; margin-top: 8px; }
    .hint {
      margin-top: 24px;
      color: #64748b;
      font-size: 13px;
    }
    .brand {
      margin-top: 32px;
      font-size: 12px;
      color: #475569;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${escapeHtml(message)}</h1>
    ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
    ${returnBlock}
    <p class="brand">Kawiil Central</p>
  </div>
</body>
</html>`;
}

function finishHtml(
  kind: "success" | "error",
  title: string,
  detail: string | undefined,
  state: ReturnType<typeof parseMicrosoftOAuthState>,
  postMessageType: "microsoft-auth-success" | "microsoft-auth-error",
  postMessageError?: string,
) {
  const mode = state?.m || "popup";
  const returnPath = sanitizeReturnPath(state?.r);
  const returnUrl =
    mode === "redirect"
      ? buildAppReturnUrl(returnPath, {
          ms: kind === "success" ? "connected" : "error",
          ...(postMessageError ? { ms_err: postMessageError.slice(0, 80) } : {}),
        })
      : undefined;

  const postMsg =
    postMessageType === "microsoft-auth-success"
      ? `window.opener?.postMessage({type:'microsoft-auth-success'},'${postMessageOrigin}');`
      : `window.opener?.postMessage({type:'microsoft-auth-error',error:${JSON.stringify(postMessageError || "error")}},'${postMessageOrigin}');`;

  return new Response(
    `<html><head></head><body>
      <script>${postMsg}</script>
      ${renderPage(kind, title, detail, { returnUrl, autoClose: mode === "popup" })}
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const state = parseMicrosoftOAuthState(rawState);
    const userId = state?.u;

    console.log("Callback received:", {
      hasCode: !!code,
      hasState: !!userId,
      mode: state?.m,
      error,
    });

    if (error) {
      return finishHtml(
        "error",
        "Error de conexión",
        error === "access_denied"
          ? "Cancelaste el permiso en Microsoft. Puedes volver a intentarlo desde Kawiil."
          : String(error),
        state,
        "microsoft-auth-error",
        error,
      );
    }

    if (!code || !userId) {
      return finishHtml(
        "error",
        "Solicitud inválida",
        "Faltan parámetros requeridos. Vuelve a Kawiil e intenta conectar de nuevo.",
        state,
        "microsoft-auth-error",
        "invalid_request",
      );
    }

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!.trim();
    const redirectUri = `${Deno.env.get("SUPABASE_URL")!.trim()}/functions/v1/microsoft-callback`;

    console.log("Exchanging code for tokens, redirectUri:", redirectUri);

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
      },
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Token exchange failed:", tokenData);
      const classified = classifyMicrosoftOAuthError(tokenData);
      const userMsg = classified?.message ||
        "No se pudo completar la autenticación con Microsoft.";
      const errCode = classified?.code === "AUTH_CONFIG_EXPIRED"
        ? "auth_config_expired"
        : "token_exchange_failed";
      return finishHtml("error", "Error al obtener token", userMsg, state, "microsoft-auth-error", errCode);
    }

    console.log("Token exchange successful, scope:", tokenData.scope);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

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
        { onConflict: "user_id" },
      );

    if (dbError) {
      console.error("DB error:", dbError);
      return finishHtml(
        "error",
        "Error al guardar",
        "No se pudieron guardar las credenciales.",
        state,
        "microsoft-auth-error",
        "db_error",
      );
    }

    console.log("Token saved successfully for user:", userId);

    return finishHtml(
      "success",
      "¡Microsoft 365 conectado!",
      "Tu cuenta se vinculó correctamente con Kawiil.",
      state,
      "microsoft-auth-success",
    );
  } catch (err) {
    console.error("Callback error:", err);
    return new Response(
      renderPage("error", "Error interno", "Ocurrió un error inesperado. Intenta de nuevo.", {
        returnUrl: buildAppReturnUrl("/microsoft365/calendario", { ms: "error" }),
      }),
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }
});
