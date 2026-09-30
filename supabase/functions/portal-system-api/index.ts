import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verifySystemRequest } from "../_shared/portal/systemAuth.ts";
import {
  DECLARATION_DOC_TYPES,
  GENERAL_DOC_TYPES,
  MIRROR_SYSTEM_OPERATIONS,
  mapDocTypeToStorage,
  SAT_DOC_TYPES,
  type PublishedInvoice,
} from "../_shared/portal/fiscalMirror.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const operations = new Set<string>(MIRROR_SYSTEM_OPERATIONS);

type Admin = SupabaseClient;

async function resolveCompany(admin: Admin, externalRef: string): Promise<string> {
  const { data, error } = await admin.from("portal_companies").select("id").eq("external_ref", externalRef).single();
  if (error) throw error;
  return data.id as string;
}

async function publishDocument(
  admin: Admin,
  companyId: string,
  payload: Record<string, unknown>,
  operation: string,
  allowed: readonly string[],
) {
  const docType = String(payload.doc_type ?? "");
  if (!allowed.includes(docType)) throw Object.assign(new Error("document_type_not_allowed"), { http: 400, code: "document_type_not_allowed" });
  const externalRef = String(payload.external_ref ?? "");
  if (!externalRef) throw Object.assign(new Error("external_ref_required"), { http: 400, code: "external_ref_required" });
  const { error } = await admin.from("portal_documents").upsert({
    client_id: companyId,
    external_ref: externalRef,
    title: String(payload.title ?? ""),
    doc_type: mapDocTypeToStorage(docType, operation),
    obtained_at: payload.obtained_at ?? null,
    period_year: payload.period_year ?? new Date().getUTCFullYear(),
    period_month: payload.period_month ?? null,
    opinion_result: payload.opinion_result ?? null,
    storage_path: String(payload.storage_path ?? ""),
    file_name: String(payload.file_name ?? "document.pdf"),
    status: "published",
    published_at: new Date().toISOString(),
  }, { onConflict: "client_id,external_ref" });
  if (error) throw error;
}

async function publishInvoice(admin: Admin, companyId: string, invoice: PublishedInvoice) {
  const uuid = String(invoice.uuid ?? "").trim().toUpperCase();
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(uuid)) {
    throw Object.assign(new Error("uuid_invalid"), { http: 400, code: "uuid_invalid" });
  }
  if (invoice.direction !== "emitida" && invoice.direction !== "recibida") {
    throw Object.assign(new Error("direction_invalid"), { http: 400, code: "direction_invalid" });
  }
  const row = {
    client_id: companyId,
    uuid,
    external_ref: invoice.external_ref ? String(invoice.external_ref) : uuid,
    direction: invoice.direction,
    source: String(invoice.source ?? "central_mirror"),
    detail_status: invoice.detail_status === "complete" ? "complete" : "metadata",
    version: invoice.version ?? null,
    issued_at: invoice.issued_at ?? null,
    issuer_rfc: invoice.issuer_rfc ?? null,
    issuer_name: invoice.issuer_name ?? null,
    receiver_rfc: invoice.receiver_rfc ?? null,
    receiver_name: invoice.receiver_name ?? null,
    voucher_type: invoice.voucher_type ?? null,
    payment_form: invoice.payment_form ?? null,
    payment_method: invoice.payment_method ?? null,
    currency: invoice.currency ?? "MXN",
    exchange_rate: invoice.exchange_rate ?? null,
    subtotal: Number(invoice.subtotal ?? 0),
    discount: Number(invoice.discount ?? 0),
    vat_transferred: Number(invoice.vat_transferred ?? 0),
    vat_withheld: Number(invoice.vat_withheld ?? 0),
    income_tax_withheld: Number(invoice.income_tax_withheld ?? 0),
    ieps: Number(invoice.ieps ?? 0),
    other_taxes: Number(invoice.other_taxes ?? 0),
    total: Number(invoice.total ?? 0),
    sat_status: invoice.sat_status ?? "unknown",
    xml_path: invoice.xml_path ?? null,
    pdf_path: invoice.pdf_path ?? null,
    is_test: invoice.is_test === true,
    flags: Array.isArray(invoice.flags) ? invoice.flags : [],
    category_name: invoice.category_name ?? null,
    category_status: invoice.category_status ?? "por_confirmar",
  };
  const { data, error } = await admin.from("portal_cfdi").upsert(row, { onConflict: "client_id,uuid" }).select("id").single();
  if (error) throw error;
  const cfdiId = data.id as string;
  await admin.from("portal_cfdi_tax_lines").delete().eq("cfdi_id", cfdiId);
  await admin.from("portal_cfdi_concepts").delete().eq("cfdi_id", cfdiId);
  if (invoice.tax_lines?.length) {
    const { error: taxErr } = await admin.from("portal_cfdi_tax_lines").insert(
      invoice.tax_lines.map((line) => ({
        cfdi_id: cfdiId,
        tax: line.tax,
        kind: line.kind,
        rate: line.rate ?? null,
        factor: line.factor ?? null,
        base: Number(line.base),
        amount: Number(line.amount),
      })),
    );
    if (taxErr) throw taxErr;
  }
  if (invoice.concepts?.length) {
    const { error: conceptErr } = await admin.from("portal_cfdi_concepts").insert(
      invoice.concepts.map((c) => ({
        cfdi_id: cfdiId,
        product_service_key: c.product_service_key ?? null,
        description: c.description,
        quantity: Number(c.quantity),
        unit_value: Number(c.unit_value),
        amount: Number(c.amount),
        discount: Number(c.discount ?? 0),
      })),
    );
    if (conceptErr) throw conceptErr;
  }
  if (invoice.payments?.length) {
    for (const payment of invoice.payments) {
      const { data: related } = await admin.from("portal_cfdi").select("id").eq("client_id", companyId).eq("uuid", String(payment.related_uuid).toUpperCase()).maybeSingle();
      if (!related?.id) continue;
      await admin.from("portal_payment_links").upsert({
        payment_cfdi_id: cfdiId,
        related_cfdi_id: related.id,
        paid_at: payment.paid_at,
        paid_amount: Number(payment.paid_amount),
      }, { onConflict: "payment_cfdi_id,related_cfdi_id,paid_at" });
    }
  }
  return cfdiId;
}

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
  const idempotencyKey = String(payload.idempotency_key ?? "").trim();
  if (!idempotencyKey || idempotencyKey.length > 200) return json({ error: "idempotency_key_required" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: prior } = await admin.from("portal_system_inbox").select("request_hash, response, operation").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (prior) {
    if (prior.operation !== operation || prior.request_hash !== verification.requestHash) {
      return json({ error: "idempotency_conflict" }, 409);
    }
    return json({ ok: true, duplicate: true, ...(prior.response as object) });
  }

  const nonce = request.headers.get("x-system-nonce")!;
  const { error: nonceError } = await admin.from("portal_system_nonces").insert({
    direction: "central_to_os",
    nonce,
    request_hash: verification.requestHash,
  });
  if (nonceError) {
    const { data: again } = await admin.from("portal_system_inbox").select("response").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (again) return json({ ok: true, duplicate: true, ...(again.response as object) });
    return json({ ok: true, duplicate: true });
  }

  try {
    const externalRef = String(payload.company_ref ?? "");
    if (!externalRef) return json({ error: "company_ref_required" }, 400);
    let companyId: string;
    let responseExtra: Record<string, unknown> = {};

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
      responseExtra = { company_id: companyId };
    } else {
      companyId = await resolveCompany(admin, externalRef);
      if (operation === "company.modules") {
        const patch: Record<string, unknown> = {
          rh_enabled: payload.rh_enabled === true,
          fiscal_enabled: payload.fiscal_enabled !== false,
          tickets_enabled: payload.tickets_enabled !== false,
        };
        if (payload.iva_basis === "issuance" || payload.iva_basis === "cash_flow") {
          await admin.from("portal_client_settings").update({ iva_basis: payload.iva_basis }).eq("client_id", companyId);
        }
        await admin.from("portal_companies").update(patch).eq("id", companyId);
      } else if (operation === "company.delete") {
        await admin.from("portal_companies").update({ status: "deleted", deleted_at: new Date().toISOString(), rfc: null }).eq("id", companyId);
      } else if (operation === "document.publish") {
        await publishDocument(admin, companyId, payload, operation, GENERAL_DOC_TYPES);
      } else if (operation === "sat_document.publish") {
        await publishDocument(admin, companyId, payload, operation, SAT_DOC_TYPES);
      } else if (operation === "declaration.publish") {
        await publishDocument(admin, companyId, { ...payload, doc_type: payload.doc_type ?? "declaration" }, operation, DECLARATION_DOC_TYPES);
      } else if (operation === "invoice.publish") {
        const invoice = (payload.invoice ?? payload) as PublishedInvoice;
        const cfdiId = await publishInvoice(admin, companyId, invoice);
        responseExtra = { cfdi_id: cfdiId };
      } else if (operation === "fiscal_summary.publish") {
        const year = Number(payload.period_year);
        const month = Number(payload.period_month);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
          return json({ error: "period_invalid" }, 400);
        }
        const summaryRef = String(payload.external_ref ?? `${year}-${String(month).padStart(2, "0")}`);
        const { error } = await admin.from("portal_fiscal_summaries").upsert({
          client_id: companyId,
          external_ref: summaryRef,
          period_year: year,
          period_month: month,
          iva_basis: payload.iva_basis === "issuance" ? "issuance" : "cash_flow",
          payload: payload.summary ?? payload.payload ?? {},
          quality: payload.quality ?? {},
          published_at: new Date().toISOString(),
        }, { onConflict: "client_id,external_ref" });
        if (error) throw error;
      } else if (operation === "alert.publish") {
        const alertRef = String(payload.external_ref ?? "");
        if (!alertRef) return json({ error: "external_ref_required" }, 400);
        const alertType = String(payload.alert_type ?? "otro");
        if (!["efos", "cancelacion", "lista_69b", "otro"].includes(alertType)) return json({ error: "alert_type_invalid" }, 400);
        const { error } = await admin.from("portal_fiscal_alerts").upsert({
          client_id: companyId,
          external_ref: alertRef,
          alert_type: alertType,
          severity: ["info", "warn", "critical"].includes(String(payload.severity)) ? payload.severity : "info",
          title: String(payload.title ?? "Alerta fiscal"),
          detail: typeof payload.detail === "string" ? payload.detail : null,
          related_uuid: typeof payload.related_uuid === "string" ? payload.related_uuid : null,
          detected_at: payload.detected_at ?? null,
          payload: payload.payload ?? {},
          published_at: new Date().toISOString(),
        }, { onConflict: "client_id,external_ref" });
        if (error) throw error;
      } else if (operation === "sat_notification.publish") {
        const noteRef = String(payload.external_ref ?? "");
        if (!noteRef) return json({ error: "external_ref_required" }, 400);
        const { error } = await admin.from("portal_sat_notifications").upsert({
          client_id: companyId,
          external_ref: noteRef,
          title: String(payload.title ?? "Notificación SAT"),
          body: typeof payload.body === "string" ? payload.body : null,
          notification_type: String(payload.notification_type ?? "sat"),
          notified_at: payload.notified_at ?? null,
          obtained_at: payload.obtained_at ?? null,
          storage_path: typeof payload.storage_path === "string" ? payload.storage_path : null,
          file_name: typeof payload.file_name === "string" ? payload.file_name : null,
          published_at: new Date().toISOString(),
        }, { onConflict: "client_id,external_ref" });
        if (error) throw error;
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

    const response = { ok: true, ...responseExtra };
    await admin.from("portal_system_inbox").insert({
      idempotency_key: idempotencyKey,
      operation,
      client_id: companyId,
      request_hash: verification.requestHash,
      response,
    });
    await admin.from("portal_audit_log").insert({
      client_id: companyId,
      action: `system.${operation}`,
      entity_type: "system_request",
      entity_id: idempotencyKey,
      details: { request_hash: verification.requestHash, nonce },
    });
    return json(response);
  } catch (error) {
    await admin.from("portal_system_nonces").delete().eq("direction", "central_to_os").eq("nonce", nonce);
    const http = typeof error === "object" && error && "http" in error ? Number((error as { http: number }).http) : 500;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "operation_failed";
    if (http !== 500) return json({ error: code }, http);
    console.error("portal-system-api", operation, error instanceof Error ? error.message : "error");
    return json({ error: "operation_failed" }, 500);
  }
});
