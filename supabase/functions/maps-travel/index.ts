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

// Mensajes claros por estatus de la Distance Matrix API (top-level o de elemento).
function messageForStatus(status: string): string {
  switch (status) {
    case "ZERO_RESULTS":
      return "No se encontró una ruta en coche entre esos dos puntos.";
    case "NOT_FOUND":
      return "No se pudo ubicar el origen o el destino. Verifica las direcciones.";
    case "MAX_ROUTE_LENGTH_EXCEEDED":
      return "La ruta es demasiado larga para calcularse.";
    case "OVER_QUERY_LIMIT":
    case "OVER_DAILY_LIMIT":
      return "Se alcanzó el límite de consultas de Google Maps. Intenta más tarde.";
    case "REQUEST_DENIED":
      return "Google Maps rechazó la solicitud (revisa la API key y sus restricciones).";
    case "INVALID_REQUEST":
      return "Solicitud inválida a Google Maps.";
    default:
      return "No se pudo calcular el trayecto.";
  }
}

// Calcula tiempo de trayecto CON tráfico entre dos lugares usando la Distance Matrix
// API de Google. La API key vive solo en el servidor (secret GOOGLE_MAPS_API_KEY)
// y nunca se registra en logs ni se expone al cliente.
// body: { origin: string, destination: string, departureTime?: ISO string }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Sin API key configurada => 500: es un problema de servidor, no del cliente.
    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
    if (!apiKey) {
      console.error("GOOGLE_MAPS_API_KEY no está configurada en el entorno.");
      return json(
        { error: "maps_not_configured", message: "El cálculo de trayectos no está configurado en el servidor." },
        500,
      );
    }

    const { origin, destination, departureTime } = await req.json();
    if (!origin || !destination) {
      return json({ error: "missing_origin_or_destination", message: "Falta el origen o el destino." }, 400);
    }

    // departure_time debe ser un epoch en segundos (>= ahora) o "now".
    let departure = "now";
    if (departureTime) {
      const t = Math.floor(new Date(departureTime).getTime() / 1000);
      const now = Math.floor(Date.now() / 1000);
      departure = String(Number.isFinite(t) ? Math.max(t, now) : now);
    }

    const params = new URLSearchParams({
      origins: origin,
      destinations: destination,
      mode: "driving",
      departure_time: departure,
      traffic_model: "best_guess",
      language: "es",
      region: "mx",
      units: "metric",
      key: apiKey,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`);
    const data = await res.json();

    // Estatus a nivel de respuesta (p.ej. REQUEST_DENIED, OVER_QUERY_LIMIT).
    if (data.status !== "OK") {
      // No registramos la API key; sí el estatus/mensaje de Google para diagnóstico.
      console.error("Distance Matrix status:", data.status, data.error_message ?? "");
      return json(
        { error: data.status || "maps_error", message: messageForStatus(data.status), detail: data.error_message ?? null },
        502,
      );
    }

    const el = data.rows?.[0]?.elements?.[0];
    if (!el || el.status !== "OK") {
      const st = el?.status || "no_route";
      return json({ error: st, message: messageForStatus(st), noRoute: true }, 200);
    }

    const traffic = el.duration_in_traffic ?? null;
    const base = el.duration ?? null;
    // duration_in_traffic es la principal; si no viene, usamos la base como fallback.
    const primary = traffic ?? base;

    return json({
      // Principal (con tráfico si está disponible).
      durationText: primary?.text ?? null,
      durationSeconds: primary?.value ?? null,
      withTraffic: !!traffic,
      // Ambas duraciones explícitas para que la UI muestre referencia.
      trafficDurationText: traffic?.text ?? null,
      trafficDurationSeconds: traffic?.value ?? null,
      baseDurationText: base?.text ?? null,
      baseDurationSeconds: base?.value ?? null,
      distanceText: el.distance?.text ?? null,
      distanceMeters: el.distance?.value ?? null,
      originResolved: data.origin_addresses?.[0] ?? origin,
      destinationResolved: data.destination_addresses?.[0] ?? destination,
    });
  } catch (error) {
    console.error("Error in maps-travel:", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
});
