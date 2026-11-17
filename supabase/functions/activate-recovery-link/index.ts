import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const textEncoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function signPayload(secret: string, email: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const payload = `${email}:${timestamp}`;
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

const DEFAULT_APP_ORIGINS = new Set([
  "https://www.kawiil-central.mx",
  "https://kawiil-central.mx",
  "https://kawiil-core-hub.lovable.app",
]);

/** Solo orígenes allowlisted y path de cambio de contraseña (anti open-redirect). */
function sanitizeRedirectTo(redirectTo: unknown, siteUrl: string): string {
  const fallbackPath = "/cambiar-contrasena?flow=direct";
  const fallbackOrigin = (() => {
    try {
      if (siteUrl) return new URL(siteUrl).origin;
    } catch { /* ignore */ }
    return "https://www.kawiil-central.mx";
  })();
  const fallback = `${fallbackOrigin}${fallbackPath}`;

  if (typeof redirectTo !== "string" || !redirectTo.trim()) return fallback;

  try {
    const u = new URL(redirectTo.trim());
    const allowed = new Set(DEFAULT_APP_ORIGINS);
    try {
      if (siteUrl) allowed.add(new URL(siteUrl).origin);
    } catch { /* ignore */ }
    const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
    for (const o of extra) allowed.add(o);

    if (!allowed.has(u.origin)) return fallback;
    if (u.pathname !== "/cambiar-contrasena") return fallback;
    return u.toString();
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, ts, sig, redirect_to } = await req.json();

    if (!email || !ts || !sig) {
      throw new Error("Datos de activación incompletos");
    }

    const issuedAt = Number(ts);
    if (!Number.isFinite(issuedAt)) {
      throw new Error("Timestamp inválido");
    }

    const now = Math.floor(Date.now() / 1000);
    const maxAgeSeconds = 60 * 60 * 24 * 14; // 14 días para activar el enlace base
    if (issuedAt > now + 300 || now - issuedAt > maxAgeSeconds) {
      throw new Error("Este enlace de activación ya expiró. Solicita uno nuevo.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const siteUrl = Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "";

    const expectedSig = await signPayload(serviceRoleKey, email, String(ts));
    if (!safeEqual(expectedSig, String(sig))) {
      throw new Error("Firma de activación inválida");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const redirectTo = sanitizeRedirectTo(redirect_to, siteUrl);

    const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (resetError) {
      const msg = resetError.message || "";
      const isRateLimited = msg.toLowerCase().includes("for security purposes") && msg.toLowerCase().includes("after");
      if (isRateLimited) {
        const secondsMatch = msg.match(/after\s+(\d+)\s+seconds/i);
        const retryAfterSeconds = secondsMatch ? Number(secondsMatch[1]) : 60;

        return new Response(JSON.stringify({
          success: false,
          rate_limited: true,
          retry_after_seconds: retryAfterSeconds,
          error: `Espera ${retryAfterSeconds}s antes de intentar nuevamente.`,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw resetError;
    }

    await adminClient
      .from("profiles")
      .update({ onboarding_status: "link_opened" })
      .eq("email", email);

    return new Response(JSON.stringify({
      success: true,
      message: "Enlace activado. Revisa tu correo para continuar.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("activate-recovery-link error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
