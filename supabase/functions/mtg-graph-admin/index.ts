import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "resolve-online-meetings";
  const mock = Deno.env.get("MTG_GRAPH_MOCK") === "1" || body.mock === true;

  if (action === "resolve-online-meetings") {
    if (mock) {
      return new Response(JSON.stringify({ resolved: 0, mock: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        error: "Requiere app permissions + ApplicationAccessPolicy (ver docs/mtg/README.md)",
      }),
      { status: 501, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  if (action === "ensure-transcript-subscription") {
    if (mock) {
      await admin.from("mtg_graph_subscriptions").insert({
        tenant_id: Deno.env.get("MICROSOFT_TENANT_ID") ?? "kawiil.mx",
        subscription_id: `mock-sub-${Date.now()}`,
        resource: "communications/onlineMeetings/getAllTranscripts",
        lifecycle_state: "mock",
      });
      return new Response(JSON.stringify({ ok: true, mock: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Admin consent pendiente (Polo)" }), {
      status: 501,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: `unknown ${action}` }), {
    status: 400,
    headers: cors,
  });
});
