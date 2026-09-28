#!/usr/bin/env node
/**
 * V2 · Regresión con un usuario del EQUIPO: con datos sintéticos idénticos, lo que
 * el staff lee y escribe por PostgREST (y en storage `documents`) debe ser IGUAL en
 * una base SIN las migraciones del portal y en otra CON ellas (cerco incluido).
 * También compara el alta de un usuario SIN la marca del portal.
 *
 * Requiere dos PostgREST: PGRST_BASE (sin portal) y PGRST_PORTAL (con portal),
 * y acceso psql a las dos bases (DB_BASE, DB_PORTAL; PGHOST/PGPORT/PGUSER).
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const SECRET = process.env.PGRST_JWT_SECRET ?? "secreto-local-de-prueba-de-32-caracteres-min";
const TARGETS = {
  base: { url: process.env.PGRST_BASE ?? "http://localhost:3056", db: process.env.DB_BASE ?? "portal_base" },
  portal: { url: process.env.PGRST_PORTAL ?? "http://localhost:3055", db: process.env.DB_PORTAL ?? "portal_api" },
};
const G4 = "d0000000-0000-0000-0000-0000000000a1";
const G1 = "d0000000-0000-0000-0000-0000000000a2";
const C1 = "d0000000-0000-0000-0000-0000000000c1";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub) {
  const h = b64u({ alg: "HS256", typ: "JWT" });
  const p = b64u({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
const VOLATILE = new Set(["id", "created_at", "updated_at", "last_accessed_at"]);
const norm = (v) => Array.isArray(v) ? v.map(norm) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
  : v;
async function req(t, sub, method, path, body) {
  const r = await fetch(`${TARGETS[t].url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt(sub)}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* vacío */ }
  return { status: r.status, data: norm(data) };
}
const sql = (t, q) => execFileSync("psql", ["-X", "-At", "-d", TARGETS[t].db, "-c", q], { encoding: "utf8" }).trim();

let fails = 0, oks = 0;
const same = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { oks++; console.log(`OK  ${msg}`); } else { fails++; console.log(`FALLA ${msg}\n  sin portal: ${JSON.stringify(a)}\n  con portal: ${JSON.stringify(b)}`); }
};

// Lecturas del equipo.
for (const [who, sub] of [["G4", G4], ["G1", G1]]) {
  for (const path of [
    `/clients?id=like.d0*&order=id`, `/tasks?id=like.d0*&order=id`, `/profiles?user_id=like.d0*&order=user_id`,
    `/fis_tax_profiles?id=like.d0*`, `/fis_receipts?id=like.d0*`, `/fis_merchants?select=slug,window_type,window_days&order=slug`,
    `/user_roles?user_id=like.d0*&select=user_id,role&order=user_id`,
  ]) {
    const [a, b] = [await req("base", sub, "GET", path), await req("portal", sub, "GET", path)];
    same(a, b, `${who} GET ${path} (${a.status})`);
  }
}
// Escrituras del equipo (mismo resultado en ambas).
const writes = [
  ["POST", "/tasks", { organization_id: "a0000000-0000-0000-0000-000000000001", client_id: C1, title: "Nueva tarea regresión" }],
  ["PATCH", `/clients?id=eq.${C1}`, { notes: "nota de regresión" }],
  ["PATCH", `/fis_receipts?id=eq.d0000000-0000-0000-0000-0000000000b1`, { status: "processing" }],
  ["POST", "/fis_tax_profiles", { organization_id: "a0000000-0000-0000-0000-000000000001", client_id: C1, rfc: "REG030303CCC", razon_social: "OTRA", cp_fiscal: "02000", regimen_fiscal: "612" }],
  ["DELETE", `/tasks?title=eq.Nueva tarea regresión`, null],
];
for (const [who, sub] of [["G4", G4], ["G1", G1]]) {
  for (const [m, p, body] of writes) {
    const [a, b] = [await req("base", sub, m, p, body), await req("portal", sub, m, p, body)];
    same({ status: a.status, data: a.data }, { status: b.status, data: b.data }, `${who} ${m} ${p} (${a.status})`);
  }
}
// Storage `documents` (policies de storage.objects) con la sesión del staff.
const asStaff = (sub, q) => `SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', false); ${q}`;
for (const [who, sub] of [["G4", G4], ["G1", G1]]) {
  const q = asStaff(sub, "SELECT count(*) FROM storage.objects WHERE bucket_id = 'documents' AND name LIKE 'regresion/%';");
  same(sql("base", q).split("\n").pop(), sql("portal", q).split("\n").pop(), `${who} lee el bucket documents igual`);
  const ins = asStaff(sub, `INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', 'regresion/${who}.pdf') RETURNING bucket_id, name;`);
  same(sql("base", ins).split("\n").pop(), sql("portal", ins).split("\n").pop(), `${who} escribe en el bucket documents igual`);
}
// Alta SIN la marca del portal: mismo perfil y rol.
const alta = "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('d0000000-0000-0000-0000-0000000000a9', 'alta.regresion@prueba.invalid', '{\"full_name\":\"Alta Regresión\"}');";
sql("base", alta); sql("portal", alta);
const altaQ = "SELECT p.organization_id || '|' || p.email || '|' || p.full_name || '|' || p.is_active || '|' || (SELECT string_agg(r.role::text, ',') FROM public.user_roles r WHERE r.user_id = p.user_id) FROM public.profiles p WHERE p.user_id = 'd0000000-0000-0000-0000-0000000000a9';";
same(sql("base", altaQ), sql("portal", altaQ), "alta sin marca del portal → perfil y rol en_formacion idénticos");

console.log(`\n${oks} OK · ${fails} FALLAS`);
process.exit(fails ? 1 : 0);
