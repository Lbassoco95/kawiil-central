/**
 * Sonda de salud del client secret Microsoft / Azure.
 * 1) client_credentials → prueba directa del secret
 * 2) refresh con token real de microsoft_tokens (camino calendario)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function azureToken(body: Record<string, string>, tenantId: string) {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    },
  );
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  return { res, data };
}

function classifyClientResult(data: Record<string, unknown>) {
  const err = String(data.error || "");
  const desc = String(data.error_description || "");
  const codes = (data.error_codes as number[] | undefined) || [];
  const hasAccess = typeof data.access_token === "string" && data.access_token.length > 20;
  const expired =
    codes.includes(7000222) ||
    (err === "invalid_client" && (desc.includes("7000222") || desc.toLowerCase().includes("expired")));
  const badSecret =
    expired ||
    (err === "invalid_client" && (desc.toLowerCase().includes("secret") || codes.includes(7000215)));
  return {
    err: err || null,
    desc_prefix: desc.slice(0, 220),
    codes,
    has_access_token: hasAccess,
    auth_config_expired: expired,
    secret_status: hasAccess ? "OK" : expired ? "EXPIRED" : badSecret ? "INVALID" : "UNKNOWN",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const clientId = (Deno.env.get("MICROSOFT_CLIENT_ID") || "").trim();
  const clientSecret = (Deno.env.get("MICROSOFT_CLIENT_SECRET") || "").trim();
  const tenantId = (Deno.env.get("MICROSOFT_TENANT_ID") || "").trim();
  const azureAlias = (Deno.env.get("AZURE_CLIENT_SECRET") || "").trim();

  if (!clientId || !clientSecret || !tenantId) {
    return Response.json(
      { secret_status: "MISSING_ENV", auth_config_expired: true },
      { status: 503 },
    );
  }

  // Prueba A: client_credentials (si la app lo permite). Si falla por scope/grant, no implica secret malo.
  const { res: ccRes, data: ccData } = await azureToken(
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    },
    tenantId,
  );
  const cc = classifyClientResult(ccData as Record<string, unknown>);

  // Prueba B: refresh_token inventado — invalid_grant clásico = secret aceptado
  const { data: badRtData } = await azureToken(
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: "kawiil-secret-probe-invalid",
      grant_type: "refresh_token",
    },
    tenantId,
  );
  const badRt = classifyClientResult(badRtData as Record<string, unknown>);
  const badRtErr = String((badRtData as { error?: string }).error || "");
  const badRtCodes = ((badRtData as { error_codes?: number[] }).error_codes) || [];
  const badRtDesc = String((badRtData as { error_description?: string }).error_description || "");
  const refreshProbeAcceptsSecret =
    badRtErr === "invalid_grant" &&
    (badRtCodes.includes(70000) ||
      badRtCodes.includes(700082) ||
      badRtCodes.includes(700084) ||
      badRtDesc.includes("AADSTS70000") ||
      badRtDesc.includes("AADSTS700082") ||
      badRtDesc.includes("refresh token"));

  // Prueba C: refresh real desde BD
  let live_refresh: Record<string, unknown> | null = null;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: row, error: rowErr } = await admin
      .from("microsoft_tokens")
      .select("user_id, refresh_token, expires_at")
      .not("refresh_token", "is", null)
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rowErr) live_refresh = { status: "DB_ERROR", message: rowErr.message };
    else if (!row?.refresh_token) live_refresh = { status: "NO_STORED_TOKENS" };
    else {
      const { res: rr, data: rd } = await azureToken(
        {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: row.refresh_token,
          grant_type: "refresh_token",
        },
        tenantId,
      );
      const cls = classifyClientResult(rd as Record<string, unknown>);
      if (cls.has_access_token) {
        const expiresIn = Number((rd as { expires_in?: number }).expires_in || 3600);
        const newExpires = new Date(Date.now() + expiresIn * 1000).toISOString();
        const newRefresh =
          (rd as { refresh_token?: string }).refresh_token || row.refresh_token;
        await admin
          .from("microsoft_tokens")
          .update({
            access_token: (rd as { access_token: string }).access_token,
            refresh_token: newRefresh,
            expires_at: newExpires,
          })
          .eq("user_id", row.user_id);
        live_refresh = {
          status: "OK",
          user_id_prefix: String(row.user_id).slice(0, 8),
          expires_at: newExpires,
          auth_config_expired: false,
          azure_http: rr.status,
        };
      } else {
        live_refresh = {
          status: cls.auth_config_expired
            ? "AUTH_CONFIG_EXPIRED"
            : cls.err === "invalid_grant"
              ? "RECONNECT_REQUIRED"
              : "FAILED",
          user_id_prefix: String(row.user_id).slice(0, 8),
          auth_config_expired: cls.auth_config_expired,
          azure_http: rr.status,
          azure_error: cls.err,
          azure_error_codes: cls.codes,
          azure_error_description_prefix: cls.desc_prefix,
        };
      }
    }
  } catch (e) {
    live_refresh = {
      status: "PROBE_ERROR",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const authConfigExpired =
    cc.auth_config_expired ||
    badRt.auth_config_expired ||
    live_refresh?.auth_config_expired === true;

  // Prueba D: si AZURE_CLIENT_SECRET difiere, probarlo con client_credentials + refresh inventado
  let azure_alias_probe: Record<string, unknown> | null = null;
  if (azureAlias && azureAlias !== clientSecret) {
    const { res: aliasCcRes, data: aliasCcData } = await azureToken(
      {
        client_id: clientId,
        client_secret: azureAlias,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      },
      tenantId,
    );
    const aliasCc = classifyClientResult(aliasCcData as Record<string, unknown>);
    const { data: aliasData } = await azureToken(
      {
        client_id: clientId,
        client_secret: azureAlias,
        refresh_token: "kawiil-secret-probe-invalid",
        grant_type: "refresh_token",
      },
      tenantId,
    );
    const aliasCls = classifyClientResult(aliasData as Record<string, unknown>);
    const aErr = String((aliasData as { error?: string }).error || "");
    const aCodes = ((aliasData as { error_codes?: number[] }).error_codes) || [];
    const aDesc = String((aliasData as { error_description?: string }).error_description || "");
    const aliasAccepts =
      aErr === "invalid_grant" &&
      (aCodes.includes(70000) ||
        aCodes.includes(700082) ||
        aDesc.includes("refresh token") ||
        aDesc.includes("AADSTS70000"));
    azure_alias_probe = {
      secret_length: azureAlias.length,
      client_credentials: {
        azure_http: aliasCcRes.status,
        ...aliasCc,
      },
      invalid_refresh: {
        ...aliasCls,
        refresh_probe_accepts_secret: aliasAccepts,
      },
      auth_config_expired: aliasCc.auth_config_expired || aliasCls.auth_config_expired,
      secret_status: aliasCc.has_access_token || aliasAccepts
        ? "OK"
        : aliasCc.auth_config_expired || aliasCls.auth_config_expired
          ? "EXPIRED"
          : aliasCc.secret_status === "INVALID" || aliasCls.secret_status === "INVALID"
            ? "INVALID"
            : "UNKNOWN",
    };
  }

  const secretStatus = cc.has_access_token || refreshProbeAcceptsSecret
    ? (authConfigExpired ? "EXPIRED" : "OK")
    : authConfigExpired
      ? "EXPIRED"
      : cc.secret_status === "INVALID" || badRt.secret_status === "INVALID"
        ? "INVALID"
        : "UNKNOWN";

  return Response.json({
    checked_at: new Date().toISOString(),
    client_id_prefix: clientId.slice(0, 8),
    tenant_id_prefix: tenantId.slice(0, 8),
    secret_length: clientSecret.length,
    azure_alias_set: !!azureAlias,
    azure_alias_matches_microsoft: azureAlias.length > 0 && azureAlias === clientSecret,
    client_credentials: {
      azure_http: ccRes.status,
      ...cc,
    },
    invalid_refresh_probe: {
      ...badRt,
      refresh_probe_accepts_secret: refreshProbeAcceptsSecret,
    },
    azure_alias_probe,
    live_refresh,
    secret_status: secretStatus,
    auth_config_expired: authConfigExpired,
  });
});
