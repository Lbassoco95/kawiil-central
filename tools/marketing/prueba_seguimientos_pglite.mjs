// Prueba de la migración de seguimientos del Analista contra Postgres real en memoria (PGlite).
//   PGLITE_PATH=<ruta a @electric-sql/pglite/dist/index.js> node tools/marketing/prueba_seguimientos_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const leer = (r) => readFileSync(new URL("../../" + r, import.meta.url), "utf8");
const sql = leer("supabase/pendientes/20261106120000_marketing_analista_seguimientos.sql"), rb = leer("tools/marketing/rollback_analista_seguimientos.sql");
const ORG = "a0000000-0000-0000-0000-000000000001", U1 = "10000000-0000-0000-0000-000000000001", U2 = "10000000-0000-0000-0000-000000000002";
let fallos = 0; const prueba = async (n, f) => { try { await f(); console.log("  ok  ", n); } catch (e) { fallos++; console.log("  FALLA", n, "\n       ", e.message); } };
const lanza = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail("debía fallar"); };

async function base() {
  const db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    create function public.mk_can_view() returns boolean language sql as $$ select true $$;
    create function public.mk_org_id() returns uuid language sql as $$ select '${ORG}'::uuid $$;
    create table public.mk_consulta (id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, pregunta text);`);
  await db.exec(sql); return db;
}
const crear = (db, u, p = "¿Cómo va el alcance?", f = "semanal") => db.query("select public.mk_seguimiento_crear($1,$2,$3,$4) id", [ORG, u, p, f]);

console.log("Seguimientos del Analista (PGlite)");
await prueba("crea un seguimiento activo con su próxima fecha", async () => {
  const db = await base(); const { rows } = await crear(db, U1);
  const r = (await db.query("select estado, frecuencia, corridas, proxima_at <= now() + interval '1 second' as vence from mk_seguimiento where id=$1", [rows[0].id])).rows[0];
  assert.deepEqual([r.estado, r.frecuencia, r.corridas, r.vence], ["activo", "semanal", 0, true]);
});
await prueba("rechaza frecuencia no válida y preguntas fuera de 3 a 500 caracteres", async () => {
  const db = await base();
  await lanza(crear(db, U1, "ok pregunta", "cada_hora"), /frecuencia/);
  await lanza(crear(db, U1, "ab"), /3 a 500/);
  await lanza(crear(db, U1, "x".repeat(501)), /3 a 500/);
});
await prueba("tope de 5 seguimientos por usuario; otro usuario no se ve afectado", async () => {
  const db = await base();
  for (let i = 0; i < 5; i++) await crear(db, U1, `pregunta número ${i}`);
  await lanza(crear(db, U1, "una más"), /tope de 5/);
  await crear(db, U2, "de otro usuario");
});
await prueba("reclamar: toma los vencidos, los adelanta y no los repite", async () => {
  const db = await base();
  await crear(db, U1, "diaria uno", "diaria"); await crear(db, U1, "semanal uno", "semanal");
  const a = (await db.query("select * from public.mk_seguimiento_reclamar(5)")).rows;
  assert.equal(a.length, 2);
  const b = (await db.query("select * from public.mk_seguimiento_reclamar(5)")).rows;
  assert.equal(b.length, 0, "no se repiten");
  const f = (await db.query("select frecuencia, corridas, round(extract(epoch from proxima_at - now())/86400) d from mk_seguimiento order by frecuencia")).rows;
  assert.deepEqual(f.map((x) => [x.frecuencia, x.corridas, Number(x.d)]), [["diaria", 1, 1], ["semanal", 1, 7]]);
});
await prueba("una_vez se termina al correr; pausados y futuros no se reclaman", async () => {
  const db = await base();
  const u = (await crear(db, U1, "solo una vez", "una_vez")).rows[0].id; const p = (await crear(db, U1, "pausada pregunta", "diaria")).rows[0].id;
  await db.query("select public.mk_seguimiento_cambiar($1,$2,$3,'pausado')", [p, ORG, U1]);
  const r = (await db.query("select id from public.mk_seguimiento_reclamar(5)")).rows; assert.deepEqual(r.map((x) => x.id), [u]);
  assert.equal((await db.query("select estado from mk_seguimiento where id=$1", [u])).rows[0].estado, "terminado");
});
await prueba("cambiar: solo el dueño y su organización; un terminado no se reabre", async () => {
  const db = await base(); const id = (await crear(db, U1)).rows[0].id;
  await lanza(db.query("select public.mk_seguimiento_cambiar($1,$2,$3,'pausado')", [id, ORG, U2]), /no encontrado/);
  await lanza(db.query("select public.mk_seguimiento_cambiar($1,$2,$3,'pausado')", [id, "b0000000-0000-0000-0000-000000000002", U1]), /no encontrado/);
  await db.query("select public.mk_seguimiento_cambiar($1,$2,$3,'terminado')", [id, ORG, U1]);
  await lanza(db.query("select public.mk_seguimiento_cambiar($1,$2,$3,'activo')", [id, ORG, U1]), /terminado/);
});
await prueba("permisos: solo service_role ejecuta; los usuarios solo leen la tabla", async () => {
  const db = await base();
  const acl = (await db.query("select proname, proacl::text a from pg_proc where proname like 'mk_seguimiento_%' order by 1")).rows;
  assert.equal(acl.length, 3);
  for (const f of acl) { assert.match(f.a, /service_role=X/); assert.doesNotMatch(f.a, /anon|authenticated|=X\/postgres,?$/); }
  const g = (await db.query("select grantee, privilege_type from information_schema.role_table_grants where table_name='mk_seguimiento' and grantee in ('anon','authenticated','PUBLIC')")).rows;
  assert.deepEqual(g, [{ grantee: "authenticated", privilege_type: "SELECT" }]);
  assert.equal((await db.query("select relrowsecurity r from pg_class where relname='mk_seguimiento'")).rows[0].r, true);
});
await prueba("reversa: deja la base como estaba (mk_consulta sin la columna)", async () => {
  const db = await base(); await db.exec(rb);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'mk_seguimiento_%'")).rows[0].n, 0);
  assert.equal((await db.query("select to_regclass('public.mk_seguimiento') t")).rows[0].t, null);
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='mk_consulta' and column_name='seguimiento_id'")).rows[0].n, 0);
});
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas de seguimientos pasaron"); process.exit(fallos ? 1 : 0);
