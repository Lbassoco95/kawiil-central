import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Autocompletado de lugares (Google Places API New). La API key vive solo en el
// servidor (secret GOOGLE_MAPS_API_KEY) y nunca se registra ni se expone al cliente.
// body: { input: string, sessionToken?: string }
// Respuesta: { predictions: [{ placeId, description, mainText, secondaryText }] }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
    if (!apiKey) {
      console.error("GOOGLE_MAPS_API_KEY no está configurada en el entorno.");
      return json({ error: "maps_not_configured", predictions: [] }, 200);
    }

    const { input, sessionToken } = await req.json();
    const query = (input ?? "").toString().trim();
    // Autocompletar solo a partir de 3 caracteres para no gastar cuota.
    if (query.length < 3) return json({ predictions: [] }, 200);

    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      },
      body: JSON.stringify({
        input: query,
        languageCode: "es",
        regionCode: "MX",
        ...(sessionToken ? { sessionToken } : {}),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      // p.ej. Places API (New) sin habilitar en el proyecto -> degradar sin romper UI.
      const gStatus = data?.error?.status || "";
      const gMessage = data?.error?.message || "";
      console.error("Places autocomplete error:", res.status, gStatus, gMessage);
      const notEnabled = res.status === 403 || /SERVICE_DISABLED|PERMISSION_DENIED|API_KEY/i.test(`${gStatus} ${gMessage}`);
      // detail sin exponer la key: solo el status HTTP y el status/mensaje de Google.
      const detail = `HTTP ${res.status}${gStatus ? ` ${gStatus}` : ""}${gMessage ? `: ${gMessage}` : ""}`;
      return json({ error: notEnabled ? "places_not_enabled" : "places_error", detail, predictions: [] }, 200);
    }

    const predictions = (data.suggestions ?? [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({
        placeId: p.placeId ?? null,
        description: p.text?.text ?? "",
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
      }))
      .filter((p: any) => p.description);

    return json({ predictions });
  } catch (error) {
    console.error("Error in maps-places:", (error as Error).message);
    return json({ error: (error as Error).message, predictions: [] }, 200);
  }
});
