// Prueba de la migración «comunicación interna» contra Postgres real en memoria (PGlite).
//   PGLITE_PATH=<ruta a @electric-sql/pglite/dist/index.js> node tools/marketing/prueba_comunicacion_interna_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const leer = (r) => readFileSync(new URL("../../" + r, import.meta.url), "utf8");
const sql = leer("supabase/migrations/20261116221332_marketing_comunicacion_interna.sql"), rb = leer("tools/marketing/rollback_comunicacion_interna.sql");
const ORG = "00000000-0000-0000-0000-000000000001";
let fallos = 0; const prueba = async (n, f) => { try { await f(); console.log("  ok  ", n); } catch (e) { fallos++; console.log("  FALLA", n, "\n       ", e.message); } };
const lanza = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail("debía fallar"); };

async function base() {
  const db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    create table public.agent_registry (id uuid primary key default gen_random_uuid(), organization_id uuid not null, name text not null, display_name text, description text, role text,
      status text default 'idle', kind text, model text, capabilities jsonb, config jsonb, last_heartbeat timestamptz, last_task_at timestamptz, tasks_completed int default 0, tasks_failed int default 0,
      updated_at timestamptz default now(), unique (organization_id, name));
    create table public.agent_tasks (id uuid primary key default gen_random_uuid(), organization_id uuid, agent_id uuid references public.agent_registry(id), task_type text, title text, priority text,
      status text, started_at timestamptz, completed_at timestamptz, result jsonb, result_summary text, input_context jsonb);
    insert into public.agent_registry (organization_id, name, kind) values ('${ORG}', 'marketing_cmo', 'system');`);
  await db.exec(sql); return db;
}
const aviso = (db, o = {}) => {
  const a = { tipo: "dia_inhabil", titulo: "Hoy no se trabaja", mensaje: "Retomamos mañana", desde: "2026-11-16", hasta: "2026-11-16", estado: "publicado", ...o };
  return db.query("insert into aviso_equipo (tipo,titulo,mensaje,desde,hasta,estado) values ($1,$2,$3,$4,$5,$6) returning id", [a.tipo, a.titulo, a.mensaje, a.desde, a.hasta, a.estado]);
};

console.log("Comunicación interna (PGlite)");
await prueba("registra el agente del sistema, sin tocar a los demás, y no se duplica al repetir", async () => {
  const db = await base(); await db.exec(sql);
  const r = (await db.query("select name, kind, config->>'solo_lectura' sl from agent_registry order by name")).rows;
  assert.deepEqual(r.map((x) => x.name), ["marketing_cmo", "marketing_comunicacion_interna"]);
  assert.equal(r[1].kind, "system"); assert.equal(r[1].sl, "false");
});
await prueba("mk_registrar_corrida y mk_latido_agente aceptan al agente nuevo y siguen rechazando a cualquier otro", async () => {
  const db = await base();
  const t = (await db.query("select public.mk_registrar_corrida('marketing_comunicacion_interna','completed','Aviso','ok') id")).rows[0].id;
  assert.ok(t);
  assert.equal((await db.query("select tasks_completed from agent_registry where name='marketing_comunicacion_interna'")).rows[0].tasks_completed, 1);
  await db.query("select public.mk_latido_agente('marketing_comunicacion_interna')");
  await lanza(db.query("select public.mk_registrar_corrida('marketing_intruso','completed','x','y')"), /no permitido/);
  await db.query("select public.mk_registrar_corrida('marketing_cmo','completed','x','y')");
});
await prueba("aviso_equipo: valida tipo, estado, textos y fechas (fin >= inicio, máximo 31 días)", async () => {
  const db = await base(); await aviso(db);
  await lanza(aviso(db, { tipo: "otro" }), /check/i); await lanza(aviso(db, { estado: "borrador" }), /check/i);
  await lanza(aviso(db, { titulo: "ab" }), /check/i); await lanza(aviso(db, { mensaje: "x".repeat(601) }), /check/i);
  await lanza(aviso(db, { desde: "2026-11-20", hasta: "2026-11-18" }), /check/i); await lanza(aviso(db, { desde: "2026-11-01", hasta: "2026-12-05" }), /check/i);
  await aviso(db, { desde: "2026-11-01", hasta: "2026-12-02" });
});
await prueba("permisos: los usuarios con sesión solo leen avisos PUBLICADOS; no escriben; anon no ve nada", async () => {
  const db = await base(); await aviso(db, { titulo: "Publicado visible" }); await aviso(db, { titulo: "Cancelado oculto", estado: "cancelado" });
  const g = (await db.query("select grantee, privilege_type from information_schema.role_table_grants where table_name='aviso_equipo' and grantee in ('anon','authenticated','PUBLIC')")).rows;
  assert.deepEqual(g, [{ grantee: "authenticated", privilege_type: "SELECT" }]);
  assert.equal((await db.query("select relrowsecurity r from pg_class where relname='aviso_equipo'")).rows[0].r, true);
  await db.exec("set role authenticated");
  assert.deepEqual((await db.query("select titulo from aviso_equipo")).rows, [{ titulo: "Publicado visible" }]);
  await lanza(db.query("insert into aviso_equipo (titulo,mensaje,desde,hasta) values ('abc','abc','2026-11-16','2026-11-16')"), /permission denied/i);
  await lanza(db.query("update aviso_equipo set estado='cancelado'"), /permission denied/i);
  await db.exec("reset role; set role anon");
  await lanza(db.query("select * from aviso_equipo"), /permission denied/i);
});
await prueba("reversa: quita la tabla, el agente y sus corridas, y las funciones vuelven a rechazar al agente", async () => {
  const db = await base(); await db.query("select public.mk_registrar_corrida('marketing_comunicacion_interna','completed','Aviso','ok')");
  await db.exec(rb);
  assert.equal((await db.query("select to_regclass('public.aviso_equipo') t")).rows[0].t, null);
  assert.equal((await db.query("select count(*)::int n from agent_registry where name='marketing_comunicacion_interna'")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from agent_tasks")).rows[0].n, 0);
  await lanza(db.query("select public.mk_registrar_corrida('marketing_comunicacion_interna','completed','x','y')"), /no permitido/);
  await db.query("select public.mk_registrar_corrida('marketing_cmo','completed','x','y')");
});
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas de comunicación interna pasaron"); process.exit(fallos ? 1 : 0);
