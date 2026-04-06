/**
 * Webhook Calendly → actualiza leads y actividades (service_role RPC).
 * Secrets: CALENDLY_WEBHOOK_SIGNING_KEY, CALENDLY_ORGANIZATION_ID;
 * opcional: CALENDLY_TARGET_STAGE_SLUG, CALENDLY_API_TOKEN (si el payload solo trae URIs).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, calendly-webhook-signature",
};

const MAX_SIGNATURE_AGE_SEC = 300;

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
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function parseCalendlySignature(header: string | null): { t: string; v1: string } | null {
  if (!header) return null;
  const parts = header.split(",").map((p) => p.trim());
  let t = "";
  let v1 = "";
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    const v = rest.join("=");
    if (k === "t") t = v;
    if (k === "v1") v1 = v;
  }
  if (!t || !v1) return null;
  return { t, v1 };
}

async function fetchCalendlyResource(
  uri: string,
  token: string,
): Promise<Record<string, unknown>> {
  const r = await fetch(uri, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) {
    const tx = await r.text();
    throw new Error(`Calendly ${r.status}: ${tx.slice(0, 200)}`);
  }
  const j = await r.json();
  return (j.resource ?? j) as Record<string, unknown>;
}

async function resolveInviteeEmail(
  invitee: unknown,
  token: string | undefined,
): Promise<string | null> {
  if (invitee && typeof invitee === "object" && invitee !== null && "email" in invitee) {
    const em = (invitee as { email?: string }).email;
    if (typeof em === "string" && em.trim()) return em.trim().toLowerCase();
  }
  if (typeof invitee === "string" && token) {
    const res = await fetchCalendlyResource(invitee, token);
    const em = res.email;
    if (typeof em === "string" && em.trim()) return em.trim().toLowerCase();
  }
  return null;
}

async function resolveEventStartTime(
  ev: unknown,
  token: string | undefined,
): Promise<string | null> {
  if (ev && typeof ev === "object" && ev !== null && "start_time" in ev) {
    const st = (ev as { start_time?: string }).start_time;
    if (typeof st === "string" && st) return st;
  }
  if (typeof ev === "string" && token) {
    const res = await fetchCalendlyResource(ev, token);
    const st = res.start_time;
    if (typeof st === "string" && st) return st;
  }
  return null;
}

function eventUriString(payload: Record<string, unknown>): string | null {
  const ev = payload.event;
  if (typeof ev === "string") return ev;
  if (ev && typeof ev === "object" && ev !== null && "uri" in ev) {
    const u = (ev as { uri?: string }).uri;
    if (typeof u === "string") return u;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const signingKey = Deno.env.get("CALENDLY_WEBHOOK_SIGNING_KEY") || "";
  const orgId = Deno.env.get("CALENDLY_ORGANIZATION_ID") || "";
  const apiToken = Deno.env.get("CALENDLY_API_TOKEN") || undefined;
  const stageSlug = Deno.env.get("CALENDLY_TARGET_STAGE_SLUG") || "";

  const rawBody = await req.text();

  if (signingKey) {
    const sigHeader = req.headers.get("Calendly-Webhook-Signature") ||
      req.headers.get("calendly-webhook-signature");
    const parsed = parseCalendlySignature(sigHeader);
    if (!parsed) {
      return new Response(JSON.stringify({ error: "Missing or invalid signature header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const tSec = parseInt(parsed.t, 10);
    if (!Number.isFinite(tSec) || Math.abs(nowSec - tSec) > MAX_SIGNATURE_AGE_SEC) {
      return new Response(JSON.stringify({ error: "Stale webhook timestamp" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const expectedHex = await hmacSha256Hex(signingKey, `${parsed.t}.${rawBody}`);
    if (!timingSafeEq(expectedHex, parsed.v1)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const eventName = typeof body.event === "string" ? body.event : "";
  const payload = (body.payload && typeof body.payload === "object" && body.payload !== null)
    ? body.payload as Record<string, unknown>
    : {};

  if (!orgId) {
    console.error("calendly-webhook: CALENDLY_ORGANIZATION_ID not set");
    return new Response(JSON.stringify({ ok: false, error: "server_misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isBooked = eventName === "invitee.created";
  const isCanceled = eventName === "invitee.canceled";

  if (!isBooked && !isCanceled) {
    return new Response(JSON.stringify({ ok: true, ignored: true, event: eventName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let inviteeEmail: string | null = null;
  try {
    inviteeEmail = await resolveInviteeEmail(payload.invitee, apiToken);
  } catch (e) {
    console.error("calendly resolve invitee:", e);
    return new Response(JSON.stringify({ error: "calendly_api_error" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!inviteeEmail) {
    console.warn("calendly-webhook: no invitee email (set CALENDLY_API_TOKEN if payload uses URIs)");
    return new Response(JSON.stringify({ ok: false, error: "no_invitee_email" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  const { data: leadRows, error: leadErr } = await svc
    .from("leads")
    .select("id")
    .eq("organization_id", orgId)
    .ilike("email", inviteeEmail)
    .eq("is_active", true)
    .limit(1);

  if (leadErr) {
    console.error("lead lookup:", leadErr);
    return new Response(JSON.stringify({ error: leadErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const leadId = leadRows?.[0]?.id as string | undefined;
  if (!leadId) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "lead_not_found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const eventUri = eventUriString(payload);

  let startTime: string | null = null;
  if (isBooked) {
    try {
      startTime = await resolveEventStartTime(payload.event, apiToken);
    } catch (e) {
      console.error("calendly resolve event:", e);
    }
  }

  let newStageId: string | null = null;
  if (isBooked && stageSlug) {
    const { data: st } = await svc
      .from("pipeline_stages")
      .select("id")
      .eq("organization_id", orgId)
      .eq("slug", stageSlug)
      .maybeSingle();
    newStageId = (st?.id as string) ?? null;
    if (!newStageId) {
      console.warn(`calendly-webhook: stage slug not found: ${stageSlug}`);
    }
  }

  const rpcArgs = isBooked
    ? {
      p_organization_id: orgId,
      p_lead_id: leadId,
      p_event_uri: eventUri,
      p_booked_at: startTime,
      p_status: "booked",
      p_new_stage_id: newStageId,
    }
    : {
      p_organization_id: orgId,
      p_lead_id: leadId,
      p_event_uri: eventUri,
      p_booked_at: null,
      p_status: "canceled",
      p_new_stage_id: null,
    };

  const { data: rpcResult, error: rpcErr } = await svc.rpc("pipeline_calendly_apply_system", rpcArgs);

  if (rpcErr) {
    console.error("pipeline_calendly_apply_system:", rpcErr);
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, result: rpcResult }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
