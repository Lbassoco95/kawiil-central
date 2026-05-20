import { createClient } from "npm:@supabase/supabase-js@2";

const postMessageOrigin = Deno.env.get("APP_ORIGIN")?.trim() || "*";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Un solo documento HTML válido (evita anidar &lt;html&gt; dentro de &lt;body&gt;). */
function renderOAuthResultPage(opts: {
  status: "success" | "error";
  headline: string;
  subline?: string;
  /** Script a ejecutar al cargar (p. ej. postMessage al opener). Sin etiquetas &lt;script&gt;. */
  bootScript?: string;
}) {
  const { status, headline, subline, bootScript } = opts;
  const ok = status === "success";
  const h = escapeHtml(headline);
  const s = subline ? escapeHtml(subline) : "";
  const iconBg = ok
    ? "linear-gradient(145deg, rgba(16,185,129,0.25), rgba(52,211,153,0.08))"
    : "linear-gradient(145deg, rgba(244,63,94,0.2), rgba(251,113,133,0.08))";
  const ring = ok ? "rgba(52, 211, 153, 0.45)" : "rgba(251, 113, 133, 0.4)";
  const iconSvg = ok
    ? `<svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="url(#g1)" stroke-width="2" stroke-linecap="round"/><polyline points="22 4 12 14.01 9 11.01" stroke="url(#g1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#10b981"/></linearGradient></defs></svg>`
    : `<svg class="ico ico-err" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="url(#g2)" stroke-width="2"/><line x1="15" y1="9" x2="9" y2="15" stroke="url(#g2)" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke="url(#g2)" stroke-width="2" stroke-linecap="round"/><defs><linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fb7185"/><stop offset="100%" stop-color="#f43f5e"/></linearGradient></defs></svg>`;

  const boot = bootScript ? `<script>${bootScript}</script>` : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kawiil &mdash; Slack</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulseRing {
      0%, 100% { box-shadow: 0 0 0 0 ${ring}, 0 0 32px rgba(99, 102, 241, 0.15); }
      50% { box-shadow: 0 0 0 8px transparent, 0 0 40px rgba(99, 102, 241, 0.2); }
    }
    @keyframes dots { 0%, 80%, 100% { opacity: .25; transform: scale(.85); } 40% { opacity: 1; transform: scale(1); } }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: radial-gradient(ellipse 120% 80% at 50% -20%, rgba(99, 102, 241, 0.22), transparent 55%),
        radial-gradient(ellipse 80% 50% at 100% 100%, rgba(16, 185, 129, 0.08), transparent 45%),
        linear-gradient(165deg, #0b1120 0%, #1e1b4b 42%, #0f172a 100%);
      color: #f8fafc;
    }
    .card {
      animation: fadeUp 0.5s ease-out both;
      background: linear-gradient(145deg, rgba(30, 27, 75, 0.55), rgba(15, 23, 42, 0.92));
      border: 1px solid rgba(129, 140, 248, 0.25);
      border-radius: 20px;
      padding: 44px 36px 40px;
      text-align: center;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    .brand {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #a5b4fc;
      margin-bottom: 28px;
      opacity: 0.95;
    }
    .icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 88px;
      height: 88px;
      border-radius: 24px;
      background: ${iconBg};
      border: 1px solid ${ok ? "rgba(52, 211, 153, 0.35)" : "rgba(251, 113, 133, 0.35)"};
      margin: 0 auto 24px;
      animation: pulseRing 2.2s ease-in-out infinite;
    }
    .ico { width: 44px; height: 44px; }
    .ico-err { width: 40px; height: 40px; }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.3;
      margin-bottom: 10px;
      color: #f1f5f9;
    }
    .sub {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.5;
      max-width: 300px;
      margin: 0 auto;
    }
    .foot {
      margin-top: 28px;
      padding-top: 22px;
      border-top: 1px solid rgba(148, 163, 184, 0.12);
    }
    .hint {
      color: #64748b;
      font-size: 0.8125rem;
      margin-bottom: 12px;
    }
    .dots { display: flex; gap: 6px; justify-content: center; align-items: center; }
    .dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #6366f1;
      animation: dots 1.2s ease-in-out infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.15s; }
    .dots span:nth-child(3) { animation-delay: 0.3s; }
  </style>
</head>
<body>
  ${boot}
  <div class="card" role="status">
    <p class="brand">Kawiil &middot; Comunicaci&oacute;n</p>
    <div class="icon-wrap" aria-hidden="true">${iconSvg}</div>
    <h1>${h}</h1>
    ${s ? `<p class="sub">${s}</p>` : ""}
    <div class="foot">
      <p class="hint">Esta ventana se cerrar&aacute; sola en unos segundos.</p>
      <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>
  </div>
  <script>
    setTimeout(function () { window.close(); }, 2800);
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
    const errDesc = url.searchParams.get("error_description");

    if (errParam) {
      const boot =
        `try{window.opener?.postMessage({type:'slack-auth-error',error:${JSON.stringify(errParam)}},${JSON.stringify(postMessageOrigin)});}catch(_){}`;
      const detail = errDesc ? ` ${decodeURIComponent(errDesc.replace(/\+/g, " "))}` : "";
      return new Response(
        renderOAuthResultPage({
          status: "error",
          headline: "No se pudo conectar Slack",
          subline:
            `Slack respondió: ${errParam}.${detail ? ` Detalle:${detail}` : ""} Puedes cerrar esta ventana e intentar de nuevo desde Kawiil.`,
          bootScript: boot,
        }),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    if (!code || !userId) {
      return new Response(
        renderOAuthResultPage({
          status: "error",
          headline: "Enlace incompleto",
          subline: "Faltan datos de autorización. Cierra esta ventana y pulsa «Conectar Slack» otra vez en Kawiil.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
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
      const slackErr = typeof tokenData.error === "string" ? tokenData.error : "token_exchange_failed";
      const boot =
        `try{window.opener?.postMessage({type:'slack-auth-error',error:'token_exchange_failed'},${JSON.stringify(postMessageOrigin)});}catch(_){}`;
      return new Response(
        renderOAuthResultPage({
          status: "error",
          headline: "No se pudo completar la conexión",
          subline:
            `Slack no entregó el acceso (${slackErr}). Revisa la app en Slack y los permisos, o inténtalo más tarde.`,
          bootScript: boot,
        }),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const accessToken = tokenData.authed_user.access_token as string;
    const slackUserId = tokenData.authed_user.id as string;
    const slackTeamId = tokenData.team?.id as string;

    if (!slackTeamId) {
      const boot =
        `try{window.opener?.postMessage({type:'slack-auth-error',error:'no_team'},${JSON.stringify(postMessageOrigin)});}catch(_){}`;
      return new Response(
        renderOAuthResultPage({
          status: "error",
          headline: "Sin espacio de trabajo",
          subline: "Slack no devolvió un workspace. Comprueba que la app esté instalada en un equipo válido.",
          bootScript: boot,
        }),
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
      const boot =
        `try{window.opener?.postMessage({type:'slack-auth-error',error:'no_profile'},${JSON.stringify(postMessageOrigin)});}catch(_){}`;
      return new Response(
        renderOAuthResultPage({
          status: "error",
          headline: "Cuenta sin organización",
          subline: "Tu usuario no tiene una organización en Kawiil. Completa el perfil o contacta a un administrador.",
          bootScript: boot,
        }),
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
      const boot =
        `try{window.opener?.postMessage({type:'slack-auth-error',error:'db_error'},${JSON.stringify(postMessageOrigin)});}catch(_){}`;
      return new Response(
        renderOAuthResultPage({
          status: "error",
          headline: "No se pudo guardar",
          subline: "Hubo un problema al guardar la conexión. Intenta de nuevo en unos minutos.",
          bootScript: boot,
        }),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    const successBoot =
      `try{window.opener?.postMessage({type:'slack-auth-success'},${JSON.stringify(postMessageOrigin)});}catch(_){}`;
    return new Response(
      renderOAuthResultPage({
        status: "success",
        headline: "¡Conexión lista!",
        subline: "Slack quedó vinculado a tu cuenta. Esta ventana se cerrará y podrás seguir en Comunicación.",
        bootScript: successBoot,
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (err) {
    console.error("slack-user-callback:", err);
    return new Response(
      renderOAuthResultPage({
        status: "error",
        headline: "Algo salió mal",
        subline: "No pudimos terminar el proceso. Cierra esta ventana e inténtalo de nuevo.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
});
