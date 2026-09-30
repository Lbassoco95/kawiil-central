// Utilidades HTTP compartidas por las Edge Functions del Conmutador (sw-*).
// Las llaman webhooks/tools de ElevenLabs (verify_jwt=false), por lo que la
// autenticación se valida con un secreto dedicado SWITCHBOARD_WEBHOOK_SECRET.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-switchboard-secret",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Devuelve null si la petición está autorizada; si no, una Response 401.
// Acepta el secreto por 3 vías (útil según lo que permita el portal):
//   1. header  x-switchboard-secret        (server tools de ElevenLabs)
//   2. query   ?secret=…                    (post-call webhook, si no admite headers)
//   3. header  Authorization: Bearer …
// Si SWITCHBOARD_WEBHOOK_SECRET no está configurado, no se exige (útil en dev),
// pero se registra una advertencia.
export function checkWebhookAuth(req: Request): Response | null {
  const expected = Deno.env.get("SWITCHBOARD_WEBHOOK_SECRET");
  if (!expected) {
    console.warn("SWITCHBOARD_WEBHOOK_SECRET no configurado; webhook sin validar.");
    return null;
  }
  let querySecret: string | null = null;
  try {
    querySecret = new URL(req.url).searchParams.get("secret");
  } catch {
    /* URL no parseable: ignora */
  }
  const provided =
    req.headers.get("x-switchboard-secret") ??
    querySecret ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (provided && provided === expected) return null;
  return jsonResponse({ error: "Unauthorized" }, 401);
}
