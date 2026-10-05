import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySystemRequest } from "../_shared/portal/systemAuth.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const operations = new Set(["ticket.submitted", "cancellation.requested", "payroll.incidents", "message.sent"]);

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const bodyText = await request.text();
  const operation = request.headers.get("x-system-operation") ?? "";
  if (!operations.has(operation)) return json({ error: "operation_unknown" }, 404);
  const secret = Deno.env.get("OS_TO_CENTRAL_SIGNING_SECRET") ?? "";
  if (!secret) return json({ error: "not_configured" }, 503);
  const verification = await verifySystemRequest({
    timestamp: request.headers.get("x-system-timestamp") ?? "",
    nonce: request.headers.get("x-system-nonce") ?? "",
    operation,
    body: bodyText,
    signature: request.headers.get("x-system-signature") ?? "",
  }, secret);
  if (!verification.ok) return json({ error: verification.code }, 401);
  const payload = JSON.parse(bodyText || "{}") as Record<string, unknown>;
  if (typeof payload.company_ref !== "string" || typeof payload.idempotency_key !== "string") return json({ error: "invalid_payload" }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await admin.from("portal_system_inbox").upsert({
    direction: "os_to_central",
    operation,
    nonce: request.headers.get("x-system-nonce"),
    request_hash: verification.requestHash,
    company_ref: payload.company_ref,
    idempotency_key: payload.idempotency_key,
    payload,
  }, { onConflict: "direction,idempotency_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) return json({ error: "operation_failed" }, 500);
  return json({ ok: true, duplicate: !data });
});
