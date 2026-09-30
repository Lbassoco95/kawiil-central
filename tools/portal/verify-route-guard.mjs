#!/usr/bin/env node
/**
 * V1 · Verificación OBLIGATORIA después de cada despliegue (RUNBOOK §5).
 *
 * Con el token de una cuenta SINTÉTICA del portal, consulta rutas del back-office
 * y confirma que TODAS responden 403 (cerco de rutas activo), y que el
 * diagnóstico `portal_route_guard_status` dice ok (pre-request corriendo).
 *
 * Supabase (staging o producción, nunca con una cuenta real):
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<llave pública> \
 *   PORTAL_TEST_EMAIL=revisor.sintetico@… PORTAL_TEST_PASSWORD=… node tools/portal/verify-route-guard.mjs
 * PostgREST local (pruebas del repo):
 *   REST_URL=http://localhost:3055 PORTAL_TEST_JWT=<jwt> node tools/portal/verify-route-guard.mjs
 * Sale con código 0 solo si todo está bien.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

async function portalSources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await portalSources(path));
    else if ([".ts", ".tsx"].includes(extname(path))) out.push(path);
  }
  return out;
}

let staticFails = 0;
for (const file of await portalSources(fileURLToPath(new URL("../../src/portal", import.meta.url)))) {
  const rel = relative(process.cwd(), file);
  if (rel.endsWith("src/portal/lib/api.ts") || rel.endsWith("src/portal/lib/supabase.ts")) continue;
  const source = await readFile(file, "utf8");
  const direct = /\b(?:db|supabase)\s*\.\s*(?:from|rpc|storage|functions)\b|\.storage\s*\.\s*from\s*\(/g;
  if (direct.test(source)) {
    staticFails++;
    console.error(`FALLA acceso directo a datos en ${rel}`);
  }
}
if (!staticFails) console.log("OK    src/portal solo usa la API para datos de negocio");
if (staticFails || process.env.PORTAL_STATIC_ONLY === "1") process.exit(staticFails ? 1 : 0);

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const REST = (process.env.REST_URL ?? (SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "")).replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
if (!REST) {
  console.error("Falta SUPABASE_URL (o REST_URL).");
  process.exit(2);
}

async function token() {
  if (process.env.PORTAL_TEST_JWT) return process.env.PORTAL_TEST_JWT;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.PORTAL_TEST_EMAIL, password: process.env.PORTAL_TEST_PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    console.error("No se pudo iniciar sesión con la cuenta sintética del portal.");
    process.exit(2);
  }
  return j.access_token;
}

const jwt = await token();
const headers = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(ANON ? { apikey: ANON } : {}) };
const BACK_OFFICE = [
  ["GET", "/profiles"], ["GET", "/clients"], ["GET", "/tasks"], ["GET", "/lead_tasks"], ["GET", "/leads"],
  ["GET", "/slack_user_profiles"], ["GET", "/client_sat_certificates"], ["GET", "/documents"], ["GET", "/fis_tax_profiles"],
  ["GET", "/portal_csd_secrets"], ["PATCH", "/lead_tasks?id=is.null"],
  ["POST", "/rpc/detect_duplicates", { p_email: "x@prueba.invalid", p_phone: "0" }],
  ["POST", "/rpc/client_knowledge_stats", { p_org_id: "a0000000-0000-0000-0000-000000000001" }],
];
let fails = 0;
for (const [method, path, body] of BACK_OFFICE) {
  const r = await fetch(`${REST}${path}`, { method, headers, body: body ? JSON.stringify(body) : method === "PATCH" ? "{}" : undefined });
  const ok = r.status === 403;
  if (!ok) fails++;
  console.log(`${ok ? "OK   " : "FALLA"} ${method} ${path} → ${r.status}${ok ? "" : " (se esperaba 403)"}`);
}
const d = await fetch(`${REST}/rpc/portal_route_guard_status`, { method: "POST", headers, body: "{}" });
const status = d.ok ? await d.json() : null;
const guardOk = status?.ok === true;
if (!guardOk) fails++;
console.log(`${guardOk ? "OK   " : "FALLA"} diagnóstico del cerco → ${JSON.stringify(status)}`);
if (SUPABASE_URL) {
  const s = await fetch(`${SUPABASE_URL}/storage/v1/object/list/documents`, { method: "POST", headers, body: JSON.stringify({ prefix: "" }) });
  const list = s.ok ? await s.json() : [];
  const ok = !s.ok || (Array.isArray(list) && list.length === 0);
  if (!ok) fails++;
  console.log(`${ok ? "OK   " : "FALLA"} storage documents → ${s.status}, ${Array.isArray(list) ? list.length : "?"} objetos`);
}
console.log(fails ? `\n${fails} FALLAS: el cerco de rutas NO está activo. No abra el portal.` : "\nCerco de rutas verificado.");
process.exit(fails ? 1 : 0);
