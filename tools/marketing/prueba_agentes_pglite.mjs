// Prueba de mk_agentes_estado() contra un Postgres real en memoria (PGlite) con réplicas mínimas de cron.job y cron.job_run_details.
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   PGLITE_PATH=/tmp/pg/node_modules/@electric-sql/pglite/dist/index.js node tools/marketing/prueba_agentes_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const sql = readFileSync(new URL("../../supabase/pendientes/20261103120000_marketing_agentes_estado.sql", import.meta.url), "utf8");

async function nueva() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema cron;
    create table cron.job (jobid serial primary key, jobname text, schedule text, command text, active boolean default true, username text default 'postgres');
    create table cron.job_run_details (runid serial primary key, jobid int, start_time timestamptz, status text, return_message text);
    -- réplica de mk_can_view: el permiso lo decide un ajuste de la sesión (en producción lo decide el usuario autenticado)
    create function public.mk_can_view() returns boolean language sql stable as $$ select coalesce(current_setting('test.puede', true), 'si') = 'si' $$;
    insert into cron.job (jobname, schedule, command, active) values
      ('marketing-colchon-diario-0700-cdmx', '0 13 * * *', $c$select net.http_post(headers := jsonb_build_object('x-marketing-secret',(select decrypted_secret from vault.decrypted_secrets where name='MARKETING_CONNECTOR_SECRET')))$c$, true),
      ('marketing-colchon-vigia-0730-cdmx', '30 13 * * *', 'select public.mk_vigia_colchon()', true),
      ('kawiilito-cierre-1700-cdmx', '0 23 * * 1-5', 'select algo_de_otro_modulo()', true),
      ('marketing-futuro-sin-corridas', '15 14 * * 1', 'select 1', false);
    insert into cron.job_run_details (jobid, start_time, status, return_message) values
      (1, '2026-11-02T13:00:00Z', 'succeeded', 'SELECT 1'), (1, '2026-11-03T13:00:00Z', 'succeeded', 'SELECT 1'),
      (2, '2026-11-03T13:30:00Z', 'failed', 'ERROR secreto-que-no-debe-salir'), (3, '2026-11-03T23:00:00Z', 'succeeded', 'SELECT 1');
  `);
  await db.exec(sql);
  return db;
}
const q = async (db, s) => (await db.query(s)).rows;
let fallos = 0; const prueba = async (n, f) => { try { await f(); console.log("  ok  ", n); } catch (e) { fallos++; console.log("  FALLA", n, "\n       ", e.message); } };

await prueba("devuelve solo los trabajos de Marketing, con horario, activo y la ÚLTIMA ejecución", async () => {
  const db = await nueva(); const r = await q(db, "select * from public.mk_agentes_estado()");
  assert.deepEqual(r.map((x) => x.trabajo), ["marketing-colchon-diario-0700-cdmx", "marketing-colchon-vigia-0730-cdmx", "marketing-futuro-sin-corridas"]);
  const d = r[0]; assert.equal(d.horario, "0 13 * * *"); assert.equal(d.activo, true); assert.equal(new Date(d.ultima_ejecucion).toISOString(), "2026-11-03T13:00:00.000Z"); assert.equal(d.ultima_estado, "succeeded");
  assert.equal(r[1].ultima_estado, "failed");
});
await prueba("un trabajo pausado y sin corridas sale con activo=false y sin última ejecución", async () => {
  const db = await nueva(); const x = (await q(db, "select * from public.mk_agentes_estado()")).find((t) => t.trabajo === "marketing-futuro-sin-corridas");
  assert.equal(x.activo, false); assert.equal(x.ultima_ejecucion, null); assert.equal(x.ultima_estado, null);
});
await prueba("no expone el texto del comando, el mensaje de retorno ni trabajos de otros módulos", async () => {
  const db = await nueva(); const r = await q(db, "select * from public.mk_agentes_estado()");
  assert.deepEqual(Object.keys(r[0]).sort(), ["activo", "horario", "trabajo", "ultima_ejecucion", "ultima_estado"]);
  const dump = JSON.stringify(r);
  for (const prohibido of ["vault", "decrypted_secret", "MARKETING_CONNECTOR_SECRET", "secreto-que-no-debe-salir", "net.http_post", "kawiilito", "otro_modulo"]) assert.ok(!dump.includes(prohibido), prohibido);
});
await prueba("sin el permiso de ver Marketing devuelve vacío (no error)", async () => {
  const db = await nueva(); await db.exec("select set_config('test.puede', 'no', false)");
  assert.deepEqual(await q(db, "select * from public.mk_agentes_estado()"), []);
});
await prueba("es de solo lectura: no cambia ninguna tabla", async () => {
  const db = await nueva(); const antes = JSON.stringify([await q(db, "select * from cron.job order by jobid"), await q(db, "select * from cron.job_run_details order by runid")]);
  await q(db, "select * from public.mk_agentes_estado()"); await q(db, "select * from public.mk_agentes_estado()");
  assert.equal(JSON.stringify([await q(db, "select * from cron.job order by jobid"), await q(db, "select * from cron.job_run_details order by runid")]), antes);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(sql.split("$$")[1] ?? ""), "el cuerpo de la función no debe escribir");
});
await prueba("permisos: cerrada a PUBLIC y anon; abierta a authenticated y service_role; SECURITY DEFINER con search_path fijo", async () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mk_agentes_estado\(\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mk_agentes_estado\(\) TO authenticated, service_role/);
  assert.match(sql, /STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  const db = await nueva(); const a = await q(db, "select has_function_privilege('anon','public.mk_agentes_estado()','EXECUTE') anon, has_function_privilege('authenticated','public.mk_agentes_estado()','EXECUTE') aut, has_function_privilege('service_role','public.mk_agentes_estado()','EXECUTE') srv");
  assert.deepEqual([a[0].anon, a[0].aut, a[0].srv], [false, true, true]);
});
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas de mk_agentes_estado pasaron"); process.exit(fallos ? 1 : 0);
