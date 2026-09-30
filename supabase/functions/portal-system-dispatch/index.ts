import { createClient } from "npm:@supabase/supabase-js@2";
import { signSystemRequest } from "../_shared/portal/systemAuth.ts";

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) return new Response("unauthorized", { status: 401 });
  const endpoint = Deno.env.get("CENTRAL_SYSTEM_API_URL") ?? "";
  const signingSecret = Deno.env.get("OS_TO_CENTRAL_SIGNING_SECRET") ?? "";
  if (!endpoint || !signingSecret) return new Response("not configured", { status: 503 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: rows } = await admin.from("portal_system_outbox").select("*").is("delivered_at", null).lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(50);
  let delivered = 0;
  for (const row of rows ?? []) {
    const body = JSON.stringify({ ...row.payload, idempotency_key: row.idempotency_key });
    const headers = await signSystemRequest(row.operation, body, signingSecret);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      delivered++;
      await admin.from("portal_system_outbox").update({ delivered_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null }).eq("id", row.id);
    } catch (error) {
      const attempts = row.attempts + 1;
      const delayMinutes = Math.min(360, 2 ** Math.min(attempts, 8));
      await admin.from("portal_system_outbox").update({ attempts, next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(), last_error: error instanceof Error ? error.message.slice(0, 200) : "error" }).eq("id", row.id);
    }
  }
  return Response.json({ processed: rows?.length ?? 0, delivered });
});
