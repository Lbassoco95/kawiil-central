import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Calcula tiempo de trayecto CON tráfico entre dos lugares usando la Distance Matrix
// API de Google. La API key vive solo en el servidor (secret GOOGLE_MAPS_API_KEY).
// body: { origin: string, destination: string, departureTime?: ISO string }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "maps_not_configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { origin, destination, departureTime } = await req.json();
    if (!origin || !destination) {
      return new Response(JSON.stringify({ error: "missing_origin_or_destination" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // departure_time debe ser un epoch en segundos (>= ahora) o "now".
    let departure = "now";
    if (departureTime) {
      const t = Math.floor(new Date(departureTime).getTime() / 1000);
      const now = Math.floor(Date.now() / 1000);
      departure = String(Math.max(t, now));
    }

    const params = new URLSearchParams({
      origins: origin,
      destinations: destination,
      mode: "driving",
      departure_time: departure,
      traffic_model: "best_guess",
      language: "es",
      key: apiKey,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`);
    const json = await res.json();

    if (json.status !== "OK") {
      return new Response(JSON.stringify({ error: json.error_message || json.status || "maps_error" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const el = json.rows?.[0]?.elements?.[0];
    if (!el || el.status !== "OK") {
      return new Response(JSON.stringify({ error: el?.status || "no_route" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const durationInTraffic = el.duration_in_traffic || el.duration;
    return new Response(
      JSON.stringify({
        durationText: durationInTraffic?.text ?? null,
        durationSeconds: durationInTraffic?.value ?? null,
        distanceText: el.distance?.text ?? null,
        withTraffic: !!el.duration_in_traffic,
        originResolved: json.origin_addresses?.[0] ?? origin,
        destinationResolved: json.destination_addresses?.[0] ?? destination,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in maps-travel:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
