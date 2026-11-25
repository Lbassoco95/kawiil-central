// Prueba de supabase/pendientes/agent_pendientes.sql contra Postgres real en memoria (PGlite). No toca producción.
//   PGLITE_PATH=<ruta a @electric-sql/pglite/dist/index.js> node tools/agentes/prueba_pendientes_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const leer = (r) => readFileSync(new URL("../../" + r, import.meta.url), "utf8");
const sql = leer("supabase/pendientes/agent_pendientes.sql"), rb = leer("tools/agentes/rollback_agent_pendientes.sql");
const A1 = "11111111-1111-4111-8111-111111111111", A2 = "22222222-2222-4222-8222-222222222222", T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let fallos = 0; const prueba = async (n, f) => { try { await f(); console.log("  ok  ", n); } catch (e) { fallos++; console.log("  FALLA", n, "\n       ", e.message); } };
const lanza = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail("debía fallar"); };

async function base() {
  const db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function public.is_admin_or_manager(_user_id uuid) returns boolean language sql as $$ select _user_id = '99999999-9999-4999-8999-999999999999'::uuid $$;
    create table public.agent_registry (id uuid primary key); create table public.agent_tasks (id uuid primary key);
    insert into public.agent_registry values ('${A1}'), ('${A2}'); insert into public.agent_tasks values ('${T1}'), ('${T2}');`);
  await db.exec(sql); return db;
}
const ins = (db, o = {}) => { const v = { tipo: "captura_faltante", motivo: "Falta la captura de pantalla del aviso", resuelve_tipo: "persona", ...o };
  return db.query("insert into public.agent_pendientes (agent_id, task_id, tipo, motivo, resuelve_tipo, resuelve_agente_id, accion, folio, autoridad, plazo, plazo_leido) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",
    [A1, T1, v.tipo, v.motivo, v.resuelve_tipo, v.resuelve_agente_id ?? null, v.accion ?? null, v.folio ?? null, v.autoridad ?? null, v.plazo ?? null, v.plazo_leido ?? null]); };

console.log("Pendientes de los agentes (PGlite)");
await prueba("registra un pendiente con motivo y responsable, y deja su historial", async () => {
  const db = await base(); const { rows } = await ins(db);
  const h = (await db.query("select evento from agent_pendientes_historial where pendiente_id=$1", [rows[0].id])).rows;
  assert.deepEqual(h.map((x) => x.evento), ["creado"]);
});
await prueba("exige motivo (5 a 240 caracteres) y un responsable válido", async () => {
  const db = await base();
  await lanza(ins(db, { motivo: "no" }), /motivo|check/i);
  await lanza(ins(db, { motivo: "x".repeat(241) }), /motivo|check/i);
  await lanza(ins(db, { resuelve_tipo: "nadie" }), /check/i);
  await lanza(ins(db, { resuelve_tipo: "agente" }), /pendiente_resuelve_agente/);            // un agente responsable necesita su id
  await lanza(ins(db, { resuelve_tipo: "persona", resuelve_agente_id: A2 }), /pendiente_resuelve_agente/);
  await ins(db, { resuelve_tipo: "agente", resuelve_agente_id: A2 });
});
await prueba("rechaza motivos con credenciales", async () => {
  const db = await base();
  for (const m of ["La contraseña del portal es Hunter2", "Falta el token de acceso al SITI", "Usar op://Boveda/Elemento", "Mandar el código de verificación"]) await lanza(ins(db, { motivo: m }), /pendiente_sin_secretos/);
});
await prueba("autoridad: sin folio y plazo solo se acepta como «plazo no leído»; con ellos, leído", async () => {
  const db = await base();
  await lanza(ins(db, { tipo: "autoridad", resuelve_tipo: "autoridad", autoridad: "SAT", plazo_leido: true }), /pendiente_plazo_leido/);
  await lanza(ins(db, { tipo: "autoridad", resuelve_tipo: "autoridad", plazo_leido: false }), /pendiente_autoridad/);
  await ins(db, { tipo: "autoridad", resuelve_tipo: "autoridad", autoridad: "SAT", plazo_leido: false });
  await ins(db, { tipo: "autoridad", resuelve_tipo: "autoridad", autoridad: "SAT", folio: "F-123", plazo: "2026-12-10", plazo_leido: true });
});
await prueba("cerrar un pendiente deja su historial; uno cerrado no se reabre ni se cambia de agente o motivo", async () => {
  const db = await base(); const { rows } = await ins(db); const id = rows[0].id;
  await lanza(db.query("update agent_pendientes set motivo='otro motivo distinto' where id=$1", [id]), /no cambia de agente/);
  await lanza(db.query("update agent_pendientes set estado='cumplido' where id=$1", [id]), /pendiente_cierre/);   // cerrar exige fecha
  await db.query("update agent_pendientes set estado='cumplido', resuelto_en=now(), resuelto_por='Dirección' where id=$1", [id]);
  const h = (await db.query("select evento, por from agent_pendientes_historial where pendiente_id=$1 order by id", [id])).rows;
  assert.deepEqual(h.map((x) => x.evento), ["creado", "cumplido"]);
  assert.equal(h[1].por, "Dirección");
  await lanza(db.query("update agent_pendientes set estado='abierto', resuelto_en=null where id=$1", [id]), /no se reabre/);
});
await prueba("nada se borra y el historial solo se agrega", async () => {
  const db = await base(); const { rows } = await ins(db);
  await lanza(db.query("delete from agent_pendientes where id=$1", [rows[0].id]), /no se borran/);
  await lanza(db.query("update agent_pendientes_historial set por='x'"), /solo se agrega/);
  await lanza(db.query("delete from agent_pendientes_historial"), /solo se agrega/);
});
await prueba("solo Dirección lee; usuarios sin permiso y anónimos no ven nada ni escriben", async () => {
  const db = await base(); await ins(db);
  await db.exec("set role authenticated; select set_config('test.uid','99999999-9999-4999-8999-999999999999', false)");
  assert.equal((await db.query("select count(*)::int n from agent_pendientes")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from agent_pendientes_historial")).rows[0].n, 1);
  await lanza(db.query(`insert into agent_pendientes (agent_id, task_id, tipo, motivo, resuelve_tipo) values ('${A1}','${T1}','otro','motivo de prueba','persona')`), /permission denied/);
  await db.exec("select set_config('test.uid','88888888-8888-4888-8888-888888888888', false)");
  assert.equal((await db.query("select count(*)::int n from agent_pendientes")).rows[0].n, 0);
  await db.exec("reset role; set role anon");
  await lanza(db.query("select * from agent_pendientes"), /permission denied/);
});
await prueba("la reversa deja la base como estaba", async () => {
  const db = await base(); await db.exec(rb);
  const t = (await db.query("select to_regclass('public.agent_pendientes') a, to_regclass('public.agent_pendientes_historial') b")).rows[0];
  assert.deepEqual([t.a, t.b], [null, null]);
});
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas pasaron"); process.exit(fallos ? 1 : 0);
