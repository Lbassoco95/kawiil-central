import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ADMIN_CONSENT_REQUIRED,
  ADMIN_CONSENT_STATE,
  escapeHtml,
  isAdminConsentGranted,
  isAdminConsentRequired,
  jsonForScript,
  normalizeTenant,
  readMicrosoftCallbackError,
} from "../_shared/microsoftConsent.ts";

const postMessageOrigin = "*";

function renderPage(status: "success" | "error", message: string, detail?: string) {
  const isSuccess = status === "success";
  const icon = isSuccess
    ? `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Kawiil - Outlook</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #f8fafc; }
  .card { background: rgba(30,41,59,0.8); backdrop-filter: blur(12px); border: 1px solid rgba(99,102,241,0.2); border-radius: 16px; padding: 48px 40px; text-align: center; max-width: 420px; width: 90%; box-shadow: 0 25px 50px rgba(0,0,0,0.4); }
  .icon { margin-bottom: 24px; } h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
  .detail { color: #94a3b8; font-size: 14px; margin-top: 8px; } .hint { margin-top: 24px; color: #64748b; font-size: 13px; }
  .brand { margin-top: 32px; font-size: 12px; color: #475569; letter-spacing: 1px; text-transform: uppercase; }
</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1>${escapeHtml(message)}</h1>${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
<p class="hint">Esta ventana se cerrará automáticamente...</p><p class="brand">Kawiil Central</p></div>
<script>setTimeout(function(){window.close();},3000);</script></body></html>`;
}

function htmlResponse(
  status: "success" | "error",
  message: string,
  detail: string | undefined,
  postMessage: Record<string, unknown> | null,
  httpStatus = 200,
) {
  const script = postMessage
    ? `<script>window.opener?.postMessage(${jsonForScript(postMessage)},${jsonForScript(postMessageOrigin)});</script>`
    : "";
  const html = renderPage(status, message, detail).replace("<body>", `<body>${script}`);
  return new Response(html, { status: httpStatus, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("state");
    const oauthError = readMicrosoftCallbackError(url.searchParams);
    const configuredTenant = normalizeTenant(Deno.env.get("MICROSOFT_LINKED_TENANT_ID"));
    const tenant = normalizeTenant(url.searchParams.get("tenant")) || configuredTenant;

    if (userId === ADMIN_CONSENT_STATE) {
      if (isAdminConsentGranted(url.searchParams)) {
        return htmlResponse(
          "success",
          "Aprobado, ya puedes conectar",
          "El administrador aprobó Kawiil para tu organización. Vuelve a Kawiil Central y pulsa Conectar Outlook.",
          { type: "outlook-admin-consent-success", tenant },
        );
      }
      console.warn("Outlook admin consent not granted:", oauthError);
      return htmlResponse(
        "error",
        "No se completó la aprobación",
        "El administrador no aprobó Kawiil o la aprobación se canceló. Puede volver a abrir el enlace para intentarlo de nuevo.",
        null,
      );
    }

    if (oauthError.error) {
      console.warn("Outlook OAuth error:", oauthError);
      if (isAdminConsentRequired(oauthError)) {
        return htmlResponse(
          "error",
          "Tu organización requiere la aprobación de un administrador",
          "Vuelve a Kawiil Central para obtener el enlace que debes enviar a tu administrador de Microsoft 365.",
          { type: "outlook-auth-error", error: ADMIN_CONSENT_REQUIRED, tenant },
        );
      }
      const detail = oauthError.error === "access_denied"
        ? "Cancelaste el permiso en Microsoft. Puedes volver a intentarlo desde Kawiil."
        : oauthError.error;
      return htmlResponse(
        "error",
        "Error de conexión",
        detail,
        { type: "outlook-auth-error", error: oauthError.error },
      );
    }
    if (!code || !userId) {
      return htmlResponse("error", "Solicitud inválida", "Faltan parámetros requeridos.", null, 400);
    }

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
    const tenantId = Deno.env.get("MICROSOFT_LINKED_TENANT_ID")?.trim() || "common";
    const redirectUri = `${Deno.env.get("SUPABASE_URL")!.trim()}/functions/v1/outlook-account-callback`;

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
      console.error("Outlook token exchange failed:", tokenData);
      return htmlResponse(
        "error",
        "Error al obtener token",
        "No se pudo completar la autenticación con Microsoft.",
        { type: "outlook-auth-error", error: "token_exchange_failed" },
      );
    }

    // Identidad de la cuenta conectada
    let email: string | null = null;
    let displayName: string | null = null;
    let providerAccountId: string | null = null;
    try {
      const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        email = me.mail || me.userPrincipalName || null;
        displayName = me.displayName || null;
        providerAccountId = me.id || null;
      }
    } catch (_) { /* opcional */ }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();

    const { error: dbError } = await supabase
      .from("linked_accounts")
      .upsert(
        {
          user_id: userId,
          provider: "microsoft",
          email,
          display_name: displayName,
          provider_account_id: providerAccountId,
          access_token: tokenData.access_token,
          // undefined (no null): en reconexión sin refresh_token nuevo, conservar el anterior.
          refresh_token: tokenData.refresh_token ?? undefined,
          token_expires_at: expiresAt,
          scope: tokenData.scope ?? null,
          status: "connected",
          last_error: null,
        },
        { onConflict: "user_id,provider,email" },
      );

    if (dbError) {
      console.error("DB error:", dbError);
      return htmlResponse(
        "error",
        "Error al guardar",
        "No se pudieron guardar las credenciales.",
        { type: "outlook-auth-error", error: "db_error" },
      );
    }

    return htmlResponse(
      "success",
      "¡Outlook conectado!",
      "Tu cuenta se vinculó correctamente con Kawiil.",
      { type: "outlook-auth-success" },
    );
  } catch (err) {
    console.error("Outlook callback error:", err);
    return htmlResponse("error", "Error interno", "Ocurrió un error inesperado. Intenta de nuevo.", null, 500);
  }
});
