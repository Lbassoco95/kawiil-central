import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySystemRequest } from "../_shared/portal/systemAuth.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const operations = new Set(["company.upsert", "company.modules", "company.delete", "document.publish", "sat_document.publish", "message.reply"]);

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const bodyText = await request.text();
  const operation = request.headers.get("x-system-operation") ?? "";
  if (!operations.has(operation)) return json({ error: "operation_unknown" }, 404);
  const secret = Deno.env.get("CENTRAL_TO_OS_SIGNING_SECRET") ?? "";
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
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const nonce = request.headers.get("x-system-nonce")!;
  const { error: nonceError } = await admin.from("portal_system_nonces").insert({ direction: "central_to_os", nonce, request_hash: verification.requestHash });
  if (nonceError) return json({ ok: true, duplicate: true });
  try {
    const externalRef = String(payload.company_ref ?? "");
    if (!externalRef) return json({ error: "company_ref_required" }, 400);
    let companyId: string;
    if (operation === "company.upsert") {
      const { data, error } = await admin.from("portal_companies").upsert({
        external_ref: externalRef,
        name: String(payload.name ?? ""),
        rfc: typeof payload.rfc === "string" ? payload.rfc : null,
        tier: payload.tier === "basico" ? "basico" : "premier",
        status: "active",
      }, { onConflict: "external_ref" }).select("id").single();
      if (error) throw error;
      companyId = data.id;
      await admin.from("portal_client_settings").upsert({ client_id: companyId });
    } else {
      const { data, error } = await admin.from("portal_companies").select("id").eq("external_ref", externalRef).single();
      if (error) throw error;
      companyId = data.id;
      if (operation === "company.modules") {
        await admin.from("portal_companies").update({ rh_enabled: payload.rh_enabled === true, fiscal_enabled: payload.fiscal_enabled !== false, tickets_enabled: payload.tickets_enabled !== false }).eq("id", companyId);
      } else if (operation === "company.delete") {
        await admin.from("portal_companies").update({ status: "deleted", deleted_at: new Date().toISOString(), rfc: null }).eq("id", companyId);
      } else if (operation === "document.publish" || operation === "sat_document.publish") {
        const allowed = operation === "sat_document.publish" ? ["tax_status_certificate", "compliance_opinion"] : ["declaration", "payment", "financial_statement", "contract", "other"];
        if (!allowed.includes(String(payload.doc_type))) return json({ error: "document_type_not_allowed" }, 400);
        await admin.from("portal_documents").upsert({
          client_id: companyId,
          external_ref: String(payload.external_ref ?? ""),
          title: String(payload.title ?? ""),
          doc_type: payload.doc_type,
          obtained_at: payload.obtained_at ?? null,
          period_year: payload.period_year ?? new Date().getUTCFullYear(),
          period_month: payload.period_month ?? null,
          opinion_result: payload.opinion_result ?? null,
          storage_path: String(payload.storage_path ?? ""),
          file_name: String(payload.file_name ?? "document.pdf"),
          status: "published",
        }, { onConflict: "client_id,external_ref" });
      } else if (operation === "message.reply") {
        const threadId = String(payload.thread_id ?? "");
        await admin.from("portal_messages").upsert({
          thread_id: threadId,
          external_ref: String(payload.external_ref ?? ""),
          author_kind: "kawiil",
          author_name: String(payload.author_name ?? "Equipo Kawiil"),
          body: String(payload.body ?? ""),
        }, { onConflict: "thread_id,external_ref" });
        await admin.from("portal_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId).eq("client_id", companyId);
      }
    }
    await admin.from("portal_audit_log").insert({ client_id: companyId, action: `system.${operation}`, entity_type: "system_request", entity_id: nonce, details: { request_hash: verification.requestHash } });
    return json({ ok: true });
  } catch (error) {
    await admin.from("portal_system_nonces").delete().eq("direction", "central_to_os").eq("nonce", nonce);
    console.error("portal-system-api", operation, error instanceof Error ? error.message : "error");
    return json({ error: "operation_failed" }, 500);
  }
});
