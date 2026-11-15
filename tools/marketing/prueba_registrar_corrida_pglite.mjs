// Prueba de mk_registrar_corrida, mk_latido_agente y del vigía que registra, contra Postgres real en memoria (PGlite).
//   PGLITE_PATH=<ruta a @electric-sql/pglite/dist/index.js> node tools/marketing/prueba_registrar_corrida_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");

const ORG = "a0000000-0000-0000-0000-000000000001", GLOBAL = "00000000-0000-0000-0000-000000000001";
const leer = (r) => readFileSync(new URL("../../" + r, import.meta.url), "utf8");
const sqlViejoVigia = leer("supabase/migrations/20261102033958_marketing_vigia_colchon.sql");
const sqlRegistrar = leer("supabase/migrations/20261104165545_marketing_registrar_corrida.sql");
const sqlVigiaNuevo = leer("supabase/migrations/20261104165612_marketing_vigia_registra.sql");
const sqlRollback1 = leer("tools/marketing/rollback_registrar_corrida.sql");
let fallos = 0; const ok = (n) => console.log("  ok  ", n);
const prueba = async (nombre, fn) => { try { await fn(); ok(nombre); } catch (e) { fallos++; console.log("  FALLA", nombre, "\n       ", e.message); } };

async function nuevaBase({ agentes = true, vigiaNuevo = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role service_role; create role anon; create role authenticated;
    create table organizations (id uuid primary key); insert into organizations values ('${ORG}');
    create table mk_caso (id uuid primary key default gen_random_uuid(), organization_id uuid not null, numero integer generated always as identity not null,
      tipo text not null, regla_codigo text, red text, titulo text not null, descripcion text, evidencia jsonb not null default '[]', estado text not null default 'abierto',
      responsable text not null default 'vigilante', detectado_at timestamptz not null default now(), cerrado_at timestamptz, updated_at timestamptz not null default now());
    create table mk_bitacora (id uuid primary key default gen_random_uuid(), organization_id uuid not null,
      agente text not null check (agente in ('vigilante','revisor','direccion','sistema','informe_diario')), accion text not null, resultado text not null,
      detalle jsonb, caso_id uuid references mk_caso(id), registrado_at timestamptz not null default now());
    create table agent_registry (id uuid primary key default gen_random_uuid(), organization_id uuid not null, name text not null, display_name text not null,
      role text not null, status text not null default 'idle', model text, kind text not null default 'consultable',
      last_heartbeat timestamptz, last_task_at timestamptz, tasks_completed integer default 0, tasks_failed integer default 0, updated_at timestamptz default now(),
      unique (organization_id, name),
      check (kind in ('consultable','system')), check (status in ('idle','working','resting','error','offline','archived')));
    create table agent_tasks (id uuid primary key default gen_random_uuid(), organization_id uuid not null, agent_id uuid references agent_registry(id) on delete set null,
      task_type text not null default 'manual', title text not null, priority text not null default 'normal', status text not null default 'pending',
      started_at timestamptz, completed_at timestamptz, result jsonb, result_summary text, input_context jsonb default '{}',
      created_at timestamptz default now(),
      check (task_type in ('manual','scheduled','triggered','code_review','analysis','report','question','automation','test')),
      check (priority in ('low','normal','high','urgent')), check (status in ('pending','queued','in_progress','waiting_approval','completed','error','cancelled')));
    create table ai_task_events (id uuid primary key default gen_random_uuid(), task_id uuid not null references agent_tasks(id) on delete cascade, organization_id uuid not null, event_type text not null, sequence integer not null);
    create table notifications (id uuid primary key default gen_random_uuid(), n int);
    -- Un agente "consultable" existente, para comprobar que no se toca ni se puede usar.
    insert into agent_registry (organization_id, name, display_name, role, kind) values ('${GLOBAL}','coyolli','Coyolli','coyolli','consultable');
  `);
  if (agentes) for (const n of ["marketing_vigilante", "marketing_informe_diario", "marketing_vigia"])
    await db.query("insert into agent_registry (organization_id, name, display_name, role, kind, model) values ($1,$2,$2,$2,'system',null)", [GLOBAL, n]);
  await db.exec(sqlViejoVigia);
  await db.exec(sqlRegistrar);
  if (vigiaNuevo) await db.exec(sqlVigiaNuevo);
  return db;
}
const q = async (db, s, p) => (await db.query(s, p)).rows;
const N = async (db, s, p) => Number((await q(db, s, p))[0].n);
const reg = (db, ...a) => q(db, "select public.mk_registrar_corrida($1,$2,$3,$4,$5::jsonb,$6::timestamptz) id", [a[0], a[1], a[2] ?? "t", a[3] ?? "r", JSON.stringify(a[4] ?? {}), a[5] ?? new Date().toISOString()]);
const ag = async (db, n) => (await q(db, "select * from agent_registry where name=$1", [n]))[0];
const corridaHoy = (db, cuando) => db.query("insert into mk_bitacora (organization_id, agente, accion, resultado, detalle, registrado_at) values ($1,'vigilante','colchon','ok','{\"simulada\":false}',$2)", [ORG, cuando]);
const H0730 = "2026-11-02T13:30:00Z";

await prueba("mk_registrar_corrida: deja UNA tarea 'scheduled' en la organización del agente, sin conversation_id, y actualiza latido y contadores", async () => {
  const db = await nuevaBase();
  const [{ id }] = await reg(db, "marketing_vigilante", "completed", "Colchón 2026-11-02", "instagram 22 verde", { fecha: "2026-11-02", colchon: [{ red: "instagram", dias: 22 }] }, new Date(Date.now() - 5000).toISOString());
  const t = (await q(db, "select * from agent_tasks where id=$1", [id]))[0];
  assert.equal(t.task_type, "scheduled"); assert.equal(t.status, "completed"); assert.equal(t.organization_id, GLOBAL);
  assert.equal(t.title, "Colchón 2026-11-02"); assert.equal(t.result_summary, "instagram 22 verde"); assert.equal(t.input_context.conversation_id, undefined);
  assert.ok(new Date(t.started_at) < new Date(t.completed_at));
  const a = await ag(db, "marketing_vigilante");
  assert.equal(a.tasks_completed, 1); assert.equal(a.tasks_failed, 0); assert.equal(a.status, "idle");
  assert.ok(a.last_heartbeat && a.last_task_at);
  assert.equal(await N(db, "select count(*) n from ai_task_events"), 0, "no escribe eventos");
});
await prueba("con error: cuenta como fallida, el agente queda en 'error' y la siguiente corrida buena lo devuelve a 'idle'", async () => {
  const db = await nuevaBase();
  await reg(db, "marketing_informe_diario", "error", "Informe", "sin informe");
  let a = await ag(db, "marketing_informe_diario"); assert.equal(a.tasks_failed, 1); assert.equal(a.tasks_completed, 0); assert.equal(a.status, "error");
  await reg(db, "marketing_informe_diario", "completed", "Informe", "0 faltantes");
  a = await ag(db, "marketing_informe_diario"); assert.equal(a.tasks_completed, 1); assert.equal(a.tasks_failed, 1); assert.equal(a.status, "idle");
});
await prueba("rechaza agentes que no son de Marketing (Coyolli, inexistente, mayúsculas), estados inválidos y no deja nada escrito", async () => {
  const db = await nuevaBase();
  for (const n of ["coyolli", "marketing_otro", "Marketing_Vigilante", "", "marketing_vigilante'; drop table agent_tasks;--"])
    await assert.rejects(() => reg(db, n, "completed"), /agente no permitido/);
  for (const e of ["pending", "in_progress", "COMPLETED", "failed"]) await assert.rejects(() => reg(db, "marketing_vigilante", e), /estado no permitido/);
  assert.equal(await N(db, "select count(*) n from agent_tasks"), 0);
  assert.equal((await ag(db, "coyolli")).tasks_completed, 0);
});
await prueba("un agente 'marketing_*' que NO es kind='system' tampoco se acepta", async () => {
  const db = await nuevaBase({ agentes: false });
  await db.query("insert into agent_registry (organization_id, name, display_name, role, kind) values ($1,'marketing_vigilante','x','x','consultable')", [GLOBAL]);
  await assert.rejects(() => reg(db, "marketing_vigilante", "completed"), /agente no permitido/);
});
await prueba("título y resumen se recortan (200 / 300), el título vacío tiene uno por defecto y el resultado nulo queda como {}", async () => {
  const db = await nuevaBase();
  const [{ id }] = await q(db, "select public.mk_registrar_corrida('marketing_vigilante','completed',$1,$2,null,null) id", ["T".repeat(500), "R".repeat(900)]);
  const t = (await q(db, "select * from agent_tasks where id=$1", [id]))[0];
  assert.equal(t.title.length, 200); assert.equal(t.result_summary.length, 300); assert.deepEqual(t.result, {});
  const [{ id: id2 }] = await q(db, "select public.mk_registrar_corrida('marketing_vigilante','completed','   ','x') id");
  assert.equal((await q(db, "select title from agent_tasks where id=$1", [id2]))[0].title, "Corrida de Marketing");
});
await prueba("inicio futuro no produce una tarea que empieza después de terminar", async () => {
  const db = await nuevaBase();
  const [{ id }] = await reg(db, "marketing_vigilante", "completed", "t", "r", {}, "2099-01-01T00:00:00Z");
  const t = (await q(db, "select started_at <= completed_at ok from agent_tasks where id=$1", [id]))[0]; assert.equal(t.ok, true);
});
await prueba("mk_latido_agente: solo cambia el latido (no cuenta tareas ni crea ninguna) y rechaza agentes ajenos", async () => {
  const db = await nuevaBase();
  await db.query("select public.mk_latido_agente('marketing_vigia')");
  const a = await ag(db, "marketing_vigia"); assert.ok(a.last_heartbeat); assert.equal(a.last_task_at, null); assert.equal(a.tasks_completed, 0);
  assert.equal(await N(db, "select count(*) n from agent_tasks"), 0);
  await assert.rejects(() => db.query("select public.mk_latido_agente('coyolli')"), /agente no permitido/);
  assert.equal((await ag(db, "coyolli")).last_heartbeat, null);
});
await prueba("permisos: anon y authenticated NO pueden ejecutar las funciones; service_role sí", async () => {
  const db = await nuevaBase();
  for (const f of ["mk_registrar_corrida(text,text,text,text,jsonb,timestamptz)", "mk_latido_agente(text)", "mk_vigia_registra_falla(uuid,date,text,integer)"])
    for (const rol of ["anon", "authenticated", "service_role"]) {
      const r = (await q(db, `select has_function_privilege('${rol}', 'public.${f}', 'execute') p`))[0].p;
      assert.equal(r, rol === "service_role", `${rol} ${f}`);
    }
});
await prueba("vigía, todo bien: no escribe bitácora ni caso ni tarea; solo actualiza el latido de marketing_vigia", async () => {
  const db = await nuevaBase(); await corridaHoy(db, "2026-11-02T13:00:05Z");
  const antes = await N(db, "select (select count(*) from mk_bitacora)+(select count(*) from mk_caso) n");
  const r = (await q(db, "select public.mk_vigia_colchon($1::timestamptz) r", [H0730]))[0].r;
  assert.match(r, /^ok: hay registro/);
  assert.equal(await N(db, "select (select count(*) from mk_bitacora)+(select count(*) from mk_caso) n"), antes);
  assert.equal(await N(db, "select count(*) n from agent_tasks"), 0);
  assert.ok((await ag(db, "marketing_vigia")).last_heartbeat);
});
await prueba("vigía, no corrió: caso + bitácora como antes Y una tarea con error del vigía (con el número del caso)", async () => {
  const db = await nuevaBase();
  const r = (await q(db, "select public.mk_vigia_colchon($1::timestamptz) r", [H0730]))[0].r;
  assert.match(r, /SIN CORRIDA: caso #1 abierto/);
  assert.equal(await N(db, "select count(*) n from mk_caso where tipo='falla_monitoreo' and estado<>'cerrado'"), 1);
  const t = (await q(db, "select t.status, t.title, t.result, a.tasks_failed, a.status ast from agent_tasks t join agent_registry a on a.id=t.agent_id"))[0];
  assert.equal(t.status, "error"); assert.equal(t.title, "Vigía 2026-11-02"); assert.equal(t.result.caso, 1); assert.equal(t.tasks_failed, 1); assert.equal(t.ast, "error");
  // segunda vez el mismo día: sigue habiendo UN caso (no se duplica); la tarea sí se agrega
  await db.query("select public.mk_vigia_colchon($1::timestamptz)", [H0730]);
  assert.equal(await N(db, "select count(*) n from mk_caso where tipo='falla_monitoreo' and estado<>'cerrado'"), 1);
});
await prueba("vigía: si el registro de agentes falla (agente no registrado), NO se calla (bitácora) y el caso se abre igual", async () => {
  const db = await nuevaBase({ agentes: false });
  const r = (await q(db, "select public.mk_vigia_colchon($1::timestamptz) r", [H0730]))[0].r;
  assert.match(r, /SIN CORRIDA: caso #1 abierto/);
  assert.ok(await N(db, "select count(*) n from mk_bitacora where resultado like 'no se pudo registrar la falla del vigía%'") === 1);
  const db2 = await nuevaBase({ agentes: false }); await corridaHoy(db2, "2026-11-02T13:00:05Z");
  assert.match((await q(db2, "select public.mk_vigia_colchon($1::timestamptz) r", [H0730]))[0].r, /^ok:/);
  assert.equal(await N(db2, "select count(*) n from mk_bitacora where resultado like 'no se pudo registrar el latido%'"), 1);
});
await prueba("el vigía nuevo decide igual que el anterior en los mismos escenarios (corrida de ayer no cuenta; simulada no cuenta)", async () => {
  for (const [nombre, prep] of [["ayer", (d) => corridaHoy(d, "2026-11-01T13:00:05Z")], ["simulada", (d) => d.query("insert into mk_bitacora (organization_id, agente, accion, resultado, detalle) values ($1,'vigilante','colchon','x','{\"simulada\":true}')", [ORG])]]) {
    const nuevo = await nuevaBase(); await prep(nuevo);
    const viejo = await nuevaBase({ vigiaNuevo: false }); await prep(viejo);
    const a = (await q(nuevo, "select public.mk_vigia_colchon($1::timestamptz) r", [H0730]))[0].r, b = (await q(viejo, "select public.mk_vigia_colchon($1::timestamptz) r", [H0730]))[0].r;
    assert.equal(a, b, nombre);
  }
});
await prueba("la reversa elimina las funciones", async () => {
  const db = await nuevaBase({ vigiaNuevo: false }); await db.exec(sqlRollback1);
  assert.equal(await N(db, "select count(*) n from pg_proc where proname in ('mk_registrar_corrida','mk_latido_agente')"), 0);
});
if (fallos) { console.log(`\n${fallos} prueba(s) fallaron`); process.exit(1); }
console.log("\nTodas las pruebas de registrar corridas pasaron");
