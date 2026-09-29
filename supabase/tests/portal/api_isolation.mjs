#!/usr/bin/env node
/**
 * Criterio 1 por la API: con PostgREST real frente a la base de prueba (datos
 * sintéticos de 10_isolation_test.sql), el usuario A no obtiene un solo
 * registro del cliente B cambiando identificadores en URL, filtros o RPC, y
 * las rutas del back-office le responden 403 (portal_pre_request).
 *
 * Uso: PGRST_URL=http://localhost:3055 PGRST_JWT_SECRET=... node supabase/tests/portal/api_isolation.mjs
 */
import { createHmac } from "node:crypto";

const URL_BASE = process.env.PGRST_URL ?? "http://localhost:3055";
const SECRET = process.env.PGRST_JWT_SECRET ?? "secreto-local-de-prueba-de-32-caracteres-min";
const UA = "22222222-0000-0000-0000-00000000000a";
const STAFF = "11111111-0000-0000-0000-000000000001";
const A = "aaaaaaaa-0000-0000-0000-00000000000a";
const B = "bbbbbbbb-0000-0000-0000-00000000000b";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub) {
  const h = b64u({ alg: "HS256", typ: "JWT" });
  const p = b64u({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
async function req(sub, method, path, body) {
  const r = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt(sub)}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* vacío */ }
  return { status: r.status, data };
}

let fails = 0;
let oks = 0;
function check(cond, msg, extra) {
  if (cond) { oks++; console.log(`OK  ${msg}`); } else { fails++; console.log(`FALLA ${msg}`, extra ?? ""); }
}
const noRowsOrDenied = (r) => r.status === 403 || r.status === 401 || (r.status === 200 && Array.isArray(r.data) && r.data.length === 0) || r.status >= 400;

// Tablas y vistas del portal con client_id: pedir B explícitamente.
for (const t of ["portal_cfdi", "portal_cfdi_v", "portal_documents", "portal_threads", "portal_messages", "portal_message_attachments",
  "portal_tickets_v", "fis_receipts", "portal_memberships", "portal_client_settings", "portal_cancel_requests", "portal_emissions",
  "portal_csd_registry", "portal_instruction_letters", "portal_legal_acceptances"]) {
  const r = await req(UA, "GET", `/${t}?client_id=eq.${B}`);
  check(noRowsOrDenied(r), `GET /${t}?client_id=eq.B → nada`, r);
  const all = await req(UA, "GET", `/${t}?select=client_id`);
  // Las aceptaciones legales propias sin cliente (aviso al registrarse) son del usuario, no de otro cliente.
  const own = (x) => x.client_id === A || (t === "portal_legal_acceptances" && x.client_id === null);
  check(all.status !== 200 || (all.data ?? []).every(own), `GET /${t} → solo filas de A`, all.data);
}
// Filtros «ingeniosos».
for (const q of [`/portal_cfdi?or=(client_id.eq.${B},client_id.eq.${A})`, `/portal_cfdi?client_id=neq.${A}`, `/portal_cfdi?uuid=like.BBBB*`]) {
  const r = await req(UA, "GET", q);
  check(r.status === 200 && r.data.every((x) => x.client_id === A), `GET ${q} → solo A`, r.data);
}
// RPC con identificadores de B.
for (const [fn, body] of [
  ["portal_dashboard", { _client_id: B, _year: 2026, _month: 9 }],
  ["portal_emission_dossier", { _client_id: B }],
  ["portal_thread_create", { _client_id: B, _subject: "x", _body: "y" }],
  ["portal_ticket_register", { _client_id: B, _file_path: `a0000000-0000-0000-0000-000000000001/juun/clients/${B}/2026/09/receipts/x.jpg`, _file_hash: "c".repeat(64) }],
  ["portal_staff_link_account", { _user_id: UA, _client_id: B, _role: "administrador", _tier: "premier" }],
  ["portal_staff_set_emission", { _client_id: A, _enabled: true }],
]) {
  const r = await req(UA, "POST", `/rpc/${fn}`, body);
  check(r.status >= 400, `POST /rpc/${fn} con id de B → error ${r.status}`, r.data);
}
const csd = await req(UA, "POST", "/rpc/portal_csd_status", { _client_id: B });
check(csd.status === 200 && csd.data.length === 0, "POST /rpc/portal_csd_status(B) → vacío", csd.data);
// Escrituras directas.
const ins = await req(UA, "POST", "/portal_cfdi", { client_id: B, organization_id: "a0000000-0000-0000-0000-000000000001", uuid: "BBBBBBBB-0000-4000-8000-00000000FFFF", direction: "recibida", source: "carga_xml" });
check(ins.status >= 400, "POST /portal_cfdi directo → rechazado", ins);
const prof = await req(UA, "POST", "/profiles", { user_id: UA, organization_id: "a0000000-0000-0000-0000-000000000001", email: "x@x", full_name: "x" });
check(prof.status >= 400, "POST /profiles (hacerse staff) → rechazado", prof);
// Back-office: capa 2 (pre-request) → 403.
for (const p of ["/clients", "/lead_tasks", "/profiles", "/slack_user_profiles", "/client_sat_certificates", "/portal_csd_secrets", "/rpc/detect_duplicates"]) {
  const r = p.startsWith("/rpc/") ? await req(UA, "POST", p, { p_email: "a@b.c", p_phone: "1" }) : await req(UA, "GET", p);
  check(r.status === 403 || (r.status === 200 && r.data.length === 0) || r.status === 401, `${p} → ${r.status} para el portal`, r.data);
}
const patch = await req(UA, "PATCH", "/lead_tasks?id=not.is.null", { title: "pwned" });
check(patch.status === 403, "PATCH /lead_tasks → 403 (antes USING true)", patch);
// La sal de los seudónimos y las funciones que la usan no se alcanzan por la API.
for (const [method, path, body] of [
  ["GET", "/portal_pseudonym_salt?select=salt"],
  ["POST", "/rpc/portal_pseudonym_uuid", { _uid: UA }],
  ["POST", "/rpc/portal_pseudonym_text", { _value: "x@prueba.invalid" }],
  ["POST", "/rpc/portal_pseudonymize_subject", { _uid: UA, _email: null, _request_id: null }],
]) {
  const r = await req(UA, method, path, body);
  const empty = r.status === 200 && Array.isArray(r.data) && r.data.length === 0;
  check(r.status >= 400 || empty, `${method} ${path} → ${r.status} (sin acceso a la sal)`, r.data);
}
// Lo propio sí funciona.
const mine = await req(UA, "GET", `/portal_cfdi?client_id=eq.${A}`);
check(mine.status === 200 && mine.data.length > 0, "GET /portal_cfdi de A → sí ve lo suyo", mine.status);
const me = await req(UA, "POST", "/rpc/portal_me", {});
check(me.status === 200 && me.data.clients.length === 1 && me.data.clients[0].client_id === A, "POST /rpc/portal_me → solo A");
// El equipo sigue igual.
const staffLeads = await req(STAFF, "GET", "/lead_tasks");
check(staffLeads.status === 200, "staff: GET /lead_tasks → 200 (sin regresión)", staffLeads.status);
const staffClients = await req(STAFF, "GET", "/clients?select=id");
check(staffClients.status === 200 && staffClients.data.length >= 2, "staff: GET /clients → sus clientes", staffClients.status);

console.log(`\n${oks} OK · ${fails} FALLAS`);
process.exit(fails ? 1 : 0);
