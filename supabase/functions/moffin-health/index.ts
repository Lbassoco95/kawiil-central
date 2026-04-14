import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  getMoffinApiFlavor,
  moffinLegacyApiKey,
  moffinSolutionsBaseUrl,
  moffinSolutionsBearerToken,
} from "../_shared/moffinApiFlavor.ts";
import { looksLikeOauthAccessJwt } from "../_shared/moffinSolutionsAuth.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function hostPreview(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function ciecEncryptionSecretOk(): boolean {
  const a = (Deno.env.get("MOFFIN_SAT_CIEC_SECRET") ?? "").trim();
  const b = (Deno.env.get("MOFFIN_FIEL_SECRET") ?? "").trim();
  return a.length >= 32 || b.length >= 32;
}

/** Credencial Bearer para solutions-api (OAuth, BEARER explícito o JWT vía MOFFIN_API_KEY). */
function solutionsAuthConfigured(): boolean {
  const id = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID") ?? "").trim();
  const sec = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET") ?? "").trim();
  if (id && sec) return true;
  if ((Deno.env.get("MOFFIN_SOLUTIONS_BEARER") ?? "").trim().length > 0) return true;
  const staticT = moffinSolutionsBearerToken();
  return staticT.length > 0 && looksLikeOauthAccessJwt(staticT);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawAuth =
    req.headers.get("Authorization") ??
    req.headers.get("authorization") ??
    "";
  const bearerMatch = rawAuth.match(/^Bearer\s+(\S+)/i);
  const accessToken = bearerMatch?.[1];
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser(accessToken);
  const user = userData?.user;
  if (userErr || !user) {
    console.error("moffin-health auth:", userErr?.message ?? "sin usuario");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: isMgr } = await admin.rpc("is_admin_or_manager", { _user_id: user.id });
  if (!isMgr) {
    return new Response(
      JSON.stringify({ error: "Forbidden", message: "Solo administradores o referentes." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const flavor = getMoffinApiFlavor();
  const missing: string[] = [];
  const warnings: string[] = [];

  let baseUrlHost: string | null = null;
  let solutionsBaseHost: string | null = null;
  let looksLikeSandbox = false;

  if (flavor === "solutions") {
    const solBase = moffinSolutionsBaseUrl();
    solutionsBaseHost = solBase ? hostPreview(solBase.startsWith("http") ? solBase : `https://${solBase}`) : null;
    looksLikeSandbox = /sandbox/i.test(solBase);

    if (!solutionsAuthConfigured()) {
      missing.push(
        "MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET (OAuth) o MOFFIN_SOLUTIONS_BEARER (accessToken de POST …/oauth/token) o MOFFIN_API_KEY solo si es JWT de ese OAuth (no el token corto de app.moffin)",
      );
    }
    if (!ciecEncryptionSecretOk()) {
      missing.push("MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (mínimo 32 caracteres; cifrado CIEC en moffin-sat-ciec)");
    }
    if (!Deno.env.get("MOFFIN_SVIX_SIGNING_SECRET")?.trim()) {
      missing.push("MOFFIN_SVIX_SIGNING_SECRET (webhook Svix; actualización de consultas async)");
    }
    if (!moffinLegacyApiKey()) {
      warnings.push(
        "Lista 69-B: falta MOFFIN_LEGACY_API_KEY o MOFFIN_API_KEY (Token API legacy). CSF y opinión 32D no lo requieren.",
      );
    }
  } else {
    const apiKey = Deno.env.get("MOFFIN_API_KEY");
    const baseUrl = (Deno.env.get("MOFFIN_BASE_URL") ?? "").replace(/\/$/, "");
    const svix = Deno.env.get("MOFFIN_SVIX_SIGNING_SECRET");
    if (!apiKey?.trim()) missing.push("MOFFIN_API_KEY");
    if (!baseUrl) missing.push("MOFFIN_BASE_URL");
    if (!svix?.trim()) missing.push("MOFFIN_SVIX_SIGNING_SECRET");
    baseUrlHost = baseUrl ? hostPreview(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`) : null;
    looksLikeSandbox = /sandbox\.moffin/i.test(baseUrl);
  }

  const ok = missing.length === 0;

  // 200 siempre para que supabase.functions.invoke entregue el JSON (incluso si faltan secretos).
  return new Response(
    JSON.stringify({
      ok,
      apiFlavor: flavor,
      missing,
      warnings,
      ciecEncryptionOk: ciecEncryptionSecretOk(),
      legacyApiKeyConfigured: !!moffinLegacyApiKey(),
      solutionsAuthConfigured: flavor === "solutions" ? solutionsAuthConfigured() : null,
      baseUrlHost,
      solutionsBaseHost,
      looksLikeSandbox,
      hint: ok
        ? "Credenciales mínimas para el modo configurado están presentes (no se muestran valores)."
        : "Configura los secretos en Supabase → Edge Functions → Secrets.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
