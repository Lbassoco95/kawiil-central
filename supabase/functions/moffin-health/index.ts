import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  getMoffinApiFlavor,
  moffinLegacyApiKey,
  moffinSolutionsBaseUrl,
  moffinSolutionsBearerToken,
} from "../_shared/moffinApiFlavor.ts";
import { looksLikeOauthAccessJwt } from "../_shared/moffinSolutionsAuth.ts";
import { isSatgoConfigured, satgoBaseUrl, useSatgoForCsf32d } from "../_shared/satgoAuth.ts";

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

function solutionsTokenSchemeForced(): boolean {
  return (Deno.env.get("MOFFIN_SOLUTIONS_AUTH_SCHEME") ?? "").trim().toLowerCase() === "token";
}

function solutionsTokenSchemeKeyPresent(): boolean {
  const a = (Deno.env.get("MOFFIN_SOLUTIONS_API_KEY") ?? "").trim();
  const b = (Deno.env.get("MOFFIN_SOLUTIONS_BEARER") ?? "").trim();
  const c = (Deno.env.get("MOFFIN_API_KEY") ?? "").trim();
  return a.length > 0 || b.length > 0 || c.length > 0;
}

/** Credencial para solutions-api (scheme Token, OAuth, BEARER explícito o JWT vía MOFFIN_API_KEY). */
function solutionsAuthConfigured(): boolean {
  if (solutionsTokenSchemeForced()) return solutionsTokenSchemeKeyPresent();
  const id = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID") ?? "").trim();
  const sec = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET") ?? "").trim();
  if (id && sec) return true;
  if ((Deno.env.get("MOFFIN_SOLUTIONS_BEARER") ?? "").trim().length > 0) return true;
  const staticT = moffinSolutionsBearerToken();
  return staticT.length > 0 && looksLikeOauthAccessJwt(staticT);
}

function solutionsAuthMode(): "token-scheme" | "oauth" | "static-bearer" | "none" {
  if (solutionsTokenSchemeForced()) {
    return solutionsTokenSchemeKeyPresent() ? "token-scheme" : "none";
  }
  const id = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID") ?? "").trim();
  const sec = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET") ?? "").trim();
  if (id && sec) return "oauth";
  const staticT = moffinSolutionsBearerToken();
  if (staticT.length > 0) return "static-bearer";
  return "none";
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

    const satgoOn = useSatgoForCsf32d();
    if (satgoOn) {
      // CSF/32D vía SATgo: no exigir OAuth Moffin Solutions.
      if (!isSatgoConfigured()) {
        missing.push("SATGO_API_KEY o SATGO_ACCESS_TOKEN (CSF/32D vía SATgo)");
      }
    } else if (solutionsTokenSchemeForced()) {
      if (!solutionsTokenSchemeKeyPresent()) {
        missing.push(
          "MOFFIN_SOLUTIONS_AUTH_SCHEME=token requiere una API key: define MOFFIN_SOLUTIONS_API_KEY (recomendado), o reutiliza MOFFIN_SOLUTIONS_BEARER / MOFFIN_API_KEY.",
        );
      }
    } else {
      const oid = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID") ?? "").trim();
      const osec = (Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET") ?? "").trim();
      if ((oid && !osec) || (!oid && osec)) {
        missing.push(
          "OAuth incompleto: MOFFIN_SOLUTIONS_CLIENT_ID y MOFFIN_SOLUTIONS_CLIENT_SECRET deben existir los dos; si solo uno está definido, Kawiil no usa OAuth y puede fallar el perfil SAT",
        );
      }

      if (!solutionsAuthConfigured()) {
        missing.push(
          "MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET (OAuth) o MOFFIN_SOLUTIONS_BEARER (accessToken de POST …/oauth/token), o define MOFFIN_SOLUTIONS_AUTH_SCHEME=token + MOFFIN_SOLUTIONS_API_KEY para el esquema Token (API key legacy en Solutions). Alternativa CSF/32D: SATGO_API_KEY.",
        );
      }
    }
    if (!ciecEncryptionSecretOk()) {
      missing.push("MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (mínimo 32 caracteres; cifrado CIEC en moffin-sat-ciec)");
    }
    if (!satgoOn && !Deno.env.get("MOFFIN_SVIX_SIGNING_SECRET")?.trim()) {
      warnings.push(
        "MOFFIN_SVIX_SIGNING_SECRET: opcional en Solutions. CSF y opinión 32D notifican con POST JSON directo (sin firma Svix); el whsec sólo sirve si aún recibís webhooks Svix firmados (cabeceras svix-*) desde otro producto.",
      );
    }
    if (satgoOn) {
      warnings.push(
        "CSF/32D activos vía SATgo (api.sat-go.com). Lista 69-B y facturas CFDI siguen en Moffin si están configurados.",
      );
    }
    if (!moffinLegacyApiKey()) {
      warnings.push(
        "Lista 69-B: falta MOFFIN_LEGACY_API_KEY o MOFFIN_API_KEY (Token API legacy). CSF y opinión 32D no lo requieren con SATgo.",
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
  const svixSigningSecretPresent = !!(Deno.env.get("MOFFIN_SVIX_SIGNING_SECRET")?.trim());
  const moffinWebhookFullUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/moffin-webhook`;
  const satgoConfigured = isSatgoConfigured();
  const satgoCsfActive = useSatgoForCsf32d();
  const satgoHost = hostPreview(satgoBaseUrl());

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
      solutionsAuthMode: flavor === "solutions" ? solutionsAuthMode() : null,
      satgoConfigured,
      satgoCsfActive,
      satgoBaseHost: satgoHost || null,
      baseUrlHost,
      solutionsBaseHost,
      looksLikeSandbox,
      /** URL POST que debe tener Moffin/Solutions configurada (verify_jwt false en moffin-webhook). CSF/32D: POST JSON sin Svix. */
      moffinWebhookFullUrl,
      /** true si existe MOFFIN_SVIX_SIGNING_SECRET (opcional si sólo llegan POST directos Solutions). */
      svixSigningSecretPresent,
      hint: ok
        ? satgoCsfActive
          ? "CSF/32D vía SATgo; secretos mínimos presentes (no se muestran valores)."
          : "Credenciales mínimas para el modo configurado están presentes (no se muestran valores)."
        : "Configura los secretos en Supabase → Edge Functions → Secrets.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
