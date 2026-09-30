import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });
  }

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userSb = createClient(supabaseUrl, anon, { global: { headers: { Authorization: auth } } });
  const admin = createClient(supabaseUrl, service);

  const { data: userData } = await userSb.auth.getUser();
  if (!userData.user) {
    return new Response(JSON.stringify({ error: "invalid jwt" }), { status: 401, headers: cors });
  }

  const body = await req.json();
  const action = body.action as string;
  const mock = Deno.env.get("MTG_GRAPH_MOCK") === "1" || body.mock === true;

  if (action === "list-recurring-events") {
    if (mock) {
      return new Response(
        JSON.stringify({
          events: [
            {
              seriesMasterId: "mock-series-1",
              subject: "Seguimiento quincenal (mock)",
              joinUrl: "https://teams.microsoft.com/l/meetup-join/mock",
              isOnlineMeeting: true,
            },
          ],
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    // Delegado: token del owner desde microsoft_tokens (mismo patrón microsoft-api)
    return new Response(JSON.stringify({ error: "Graph real: configurar owner token; usar mock en CI" }), {
      status: 501,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (action === "link-series") {
    const { series_id, outlook_event_id, teams_join_url } = body;
    const { error } = await admin
      .from("mtg_series")
      .update({
        outlook_event_id,
        teams_join_url,
        organizer_tenant_id: Deno.env.get("MICROSOFT_TENANT_ID") ?? "kawiil.mx",
      })
      .eq("id", series_id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (action === "sync-instances") {
    return new Response(
      JSON.stringify({
        ok: true,
        mock,
        message: mock
          ? "sync-instances mock: no-op"
          : "Implementar lectura de instancias del seriesMaster vía Graph delegado",
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ error: `unknown action ${action}` }), {
    status: 400,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
