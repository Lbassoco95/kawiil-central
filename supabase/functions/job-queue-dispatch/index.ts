import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("Authorization");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Cron o service
  const okCron = cronSecret && header === cronSecret;
  let okJwt = false;
  if (auth?.startsWith("Bearer ")) {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data } = await userClient.auth.getUser();
    okJwt = !!data.user;
  }
  if (!okCron && !okJwt) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const mock = Deno.env.get("MTG_GRAPH_MOCK") === "1";
  const vmUrl = Deno.env.get("VM_DISPATCH_URL");
  const dispatchToken = Deno.env.get("KAWIIL_DISPATCH_TOKEN");

  const { data: jobs, error } = await admin.rpc("claim_jobs", {
    p_kinds: ["mtg.fetch_transcript", "mtg.generate_minutes"],
    p_limit: 5,
    p_worker_id: "job-queue-dispatch",
    p_lease_seconds: 600,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const claimed = jobs ?? [];
  if (claimed.length === 0) {
    return new Response(JSON.stringify({ claimed: 0, mock }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Re-encola a worker vía dispatch-to-agent si hay VM; si mock, completa en sitio
  const results = [];
  for (const job of claimed) {
    if (mock && job.kind === "mtg.fetch_transcript") {
      await admin.rpc("complete_job", {
        p_job_id: job.id,
        p_result: { mock: true, status: "received" },
      });
      results.push({ id: job.id, mock_completed: true });
      continue;
    }
    if (vmUrl && dispatchToken) {
      try {
        await fetch(vmUrl.replace(/\/$/, "") + "/api/jobs/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kawiil-Dispatch-Token": dispatchToken,
          },
          body: JSON.stringify({ job }),
        });
        results.push({ id: job.id, dispatched: true });
      } catch (e) {
        await admin.rpc("fail_job", {
          p_job_id: job.id,
          p_error: String(e),
        });
        results.push({ id: job.id, error: String(e) });
      }
    } else {
      results.push({ id: job.id, pending_worker: true });
    }
  }

  return new Response(JSON.stringify({ claimed: claimed.length, results, mock }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
