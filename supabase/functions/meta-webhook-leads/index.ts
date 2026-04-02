import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return "sha256=" +
    [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function parseFieldData(fieldData: { name?: string; values?: string[] }[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of fieldData || []) {
    const n = (f.name || "").toLowerCase();
    const v = (f.values && f.values[0]) || "";
    m[n] = v;
  }
  return m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const verifyToken = Deno.env.get("META_VERIFY_TOKEN") || "";
  const appSecret = Deno.env.get("META_APP_SECRET") || "";
  const pageToken = Deno.env.get("META_ACCESS_TOKEN") || "";
  const orgId = Deno.env.get("META_DEFAULT_ORGANIZATION_ID") || "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (appSecret) {
    if (!sig) {
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const expected = await hmacSha256Hex(appSecret, rawBody);
    if (!timingSafeEq(expected, sig)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (!pageToken || !orgId) {
    console.warn("meta-webhook-leads: falta META_ACCESS_TOKEN o META_DEFAULT_ORGANIZATION_ID");
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = JSON.parse(rawBody) as {
      entry?: { changes?: { field?: string; value?: { leadgen_id?: string } }[] }[];
    };
    const entries = body.entry || [];

    const { data: regStage } = await svc.from("pipeline_stages")
      .select("id")
      .eq("organization_id", orgId)
      .eq("slug", "registrado")
      .maybeSingle();

    if (!regStage?.id) {
      console.error("meta-webhook: sin etapa registrado");
      return new Response(JSON.stringify({ ok: false }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const ent of entries) {
      for (const ch of ent.changes || []) {
        if (ch.field !== "leadgen") continue;
        const leadgenId = ch.value?.leadgen_id;
        if (!leadgenId) continue;

        const graphUrl =
          `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${encodeURIComponent(pageToken)}`;
        const gr = await fetch(graphUrl);
        const gd = await gr.json();
        if (!gr.ok) {
          console.error("Meta graph lead:", gd);
          continue;
        }

        const fields = parseFieldData(gd.field_data || []);
        const fullName = fields.full_name || fields.nombre_completo || fields.name || "Lead Meta";
        const email = fields.email?.toLowerCase() || null;
        const phone = fields.phone_number || fields.teléfono || fields["phone number"] || null;

        if (email) {
          const { data: ex } = await svc.from("leads")
            .select("id")
            .eq("organization_id", orgId)
            .ilike("email", email)
            .maybeSingle();
          if (ex) continue;
        }

        const { data: ins, error: insErr } = await svc.from("leads").insert({
          organization_id: orgId,
          full_name: fullName,
          email,
          phone,
          meta_lead_id: String(leadgenId),
          meta_created_at: gd.created_time || null,
          campaign_name: gd.ad_name || gd.adset_name || null,
          form_name: gd.form_name || null,
          stage_id: regStage.id,
          source: "meta_ads",
          priority: "medium",
        }).select("id").single();

        if (insErr) {
          console.error("insert lead:", insErr);
          continue;
        }

        await svc.from("lead_activities").insert({
          lead_id: ins!.id,
          user_id: null,
          type: "lead_created",
          metadata: { source: "meta_webhook", leadgen_id: leadgenId },
        });

        const { data: seq } = await svc.from("email_sequences")
          .select("id")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .eq("trigger_stage", regStage.id)
          .maybeSingle();

        if (seq?.id) {
          const { error: enqErr } = await svc.rpc("enqueue_sequence_system", {
            p_organization_id: orgId,
            p_lead_id: ins!.id,
            p_sequence_id: seq.id,
          });
          if (enqErr) console.error("enqueue_sequence_system:", enqErr);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("meta-webhook-leads:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
