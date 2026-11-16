// Prueba de la migración «seguimientos del CMO» contra Postgres real en memoria (PGlite), encima de la migración de seguimientos del Analista.
//   PGLITE_PATH=<ruta a @electric-sql/pglite/dist/index.js> node tools/marketing/prueba_cmo_seguimientos_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const leer = (r) => readFileSync(new URL("../../" + r, import.meta.url), "utf8");
const base0 = leer("supabase/migrations/20261106003827_marketing_analista_seguimientos.sql");
const nueva = leer("supabase/migrations/20261116165640_marketing_cmo_seguimientos.sql"), rb = leer("tools/marketing/rollback_cmo_seguimientos.sql");
const ORG = "a0000000-0000-0000-0000-000000000001", U1 = "10000000-0000-0000-0000-000000000001", U2 = "10000000-0000-0000-0000-000000000002";
let fallos = 0; const prueba = async (n, f) => { try { await f(); console.log("  ok  ", n); } catch (e) { fallos++; console.log("  FALLA", n, "\n       ", e.message); } };
const lanza = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail("debía fallar"); };

async function base({ migrar = true, previos = 0 } = {}) {
  const db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    create function public.mk_can_view() returns boolean language sql as $$ select true $$;
    create function public.mk_org_id() returns uuid language sql as $$ select '${ORG}'::uuid $$;
    create table public.mk_consulta (id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, pregunta text);`);
  await db.exec(base0);
  for (let i = 0; i < previos; i++) await db.query("select public.mk_seguimiento_crear($1,$2,$3,'semanal')", [ORG, U1, `previo ${i}`]);
  if (migrar) await db.exec(nueva);
  return db;
}
const crear = (db, u, p, f = "semanal", ag) => ag === undefined
  ? db.query("select public.mk_seguimiento_crear($1,$2,$3,$4) id", [ORG, u, p, f])
  : db.query("select public.mk_seguimiento_crear($1,$2,$3,$4,now(),$5) id", [ORG, u, p, f, ag]);

console.log("Seguimientos del CMO (PGlite)");
await prueba("los seguimientos que ya existían quedan como del Analista", async () => {
  const db = await base({ migrar: false, previos: 2 }); await db.exec(nueva);
  const r = (await db.query("select agente, count(*)::int n from mk_seguimiento group by 1")).rows;
  assert.deepEqual(r, [{ agente: "marketing_analista", n: 2 }]);
});
await prueba("crear sin agente (código actual) sigue siendo del Analista; con agente, del CMO", async () => {
  const db = await base();
  const a = (await crear(db, U1, "pregunta sin agente")).rows[0].id, c = (await crear(db, U1, "pregunta del CMO", "diaria", "marketing_cmo")).rows[0].id;
  const r = (await db.query("select id, agente from mk_seguimiento")).rows;
  assert.equal(r.find((x) => x.id === a).agente, "marketing_analista"); assert.equal(r.find((x) => x.id === c).agente, "marketing_cmo");
});
await prueba("rechaza un agente que no es de la lista cerrada (función y restricción de la tabla)", async () => {
  const db = await base();
  await lanza(crear(db, U1, "pregunta rara", "semanal", "marketing_vigia"), /agente no válido/);
  await lanza(db.query("insert into mk_seguimiento (organization_id,user_id,pregunta,frecuencia,proxima_at,agente) values ($1,$2,'abc','diaria',now(),'otro')", [ORG, U1]), /check/i);
});
await prueba("el tope de 5 es por usuario y por agente", async () => {
  const db = await base();
  for (let i = 0; i < 5; i++) await crear(db, U1, `analista ${i}`);
  await lanza(crear(db, U1, "analista seis"), /tope de 5 seguimientos por usuario y agente/);
  for (let i = 0; i < 5; i++) await crear(db, U1, `cmo ${i}`, "semanal", "marketing_cmo");
  await lanza(crear(db, U1, "cmo seis", "semanal", "marketing_cmo"), /tope de 5/);
  await crear(db, U2, "otro usuario", "semanal", "marketing_cmo");
});
await prueba("reclamar devuelve el agente de cada seguimiento y sigue sin repetir", async () => {
  const db = await base();
  await crear(db, U1, "uno del analista", "diaria"); await crear(db, U1, "uno del CMO", "semanal", "marketing_cmo");
  const a = (await db.query("select * from public.mk_seguimiento_reclamar(5)")).rows;
  assert.deepEqual(a.map((x) => [x.pregunta, x.agente]).sort(), [["uno del CMO", "marketing_cmo"], ["uno del analista", "marketing_analista"]]);
  assert.equal((await db.query("select * from public.mk_seguimiento_reclamar(5)")).rows.length, 0);
});
await prueba("cambiar funciona igual para seguimientos del CMO (solo su dueño)", async () => {
  const db = await base(); const id = (await crear(db, U1, "pregunta CMO", "diaria", "marketing_cmo")).rows[0].id;
  await lanza(db.query("select public.mk_seguimiento_cambiar($1,$2,$3,'pausado')", [id, ORG, U2]), /no encontrado/);
  await db.query("select public.mk_seguimiento_cambiar($1,$2,$3,'pausado')", [id, ORG, U1]);
  assert.equal((await db.query("select estado from mk_seguimiento where id=$1", [id])).rows[0].estado, "pausado");
});
await prueba("permisos: solo service_role ejecuta las funciones; los usuarios solo leen la tabla", async () => {
  const db = await base();
  const acl = (await db.query("select proname, proacl::text a from pg_proc where proname like 'mk_seguimiento_%' order by 1")).rows;
  assert.equal(acl.length, 3, "una sola versión de cada función (sin sobrecargas)");
  for (const f of acl) { assert.match(f.a, /service_role=X/); assert.doesNotMatch(f.a, /anon|authenticated|=X\/postgres,?$/); }
  const g = (await db.query("select grantee, privilege_type from information_schema.role_table_grants where table_name='mk_seguimiento' and grantee in ('anon','authenticated','PUBLIC')")).rows;
  assert.deepEqual(g, [{ grantee: "authenticated", privilege_type: "SELECT" }]);
});
await prueba("reversa: borra solo lo del CMO y deja las funciones como estaban", async () => {
  const db = await base();
  await crear(db, U1, "del analista", "diaria"); await crear(db, U1, "del CMO", "diaria", "marketing_cmo");
  await db.exec(rb);
  assert.deepEqual((await db.query("select pregunta from mk_seguimiento")).rows, [{ pregunta: "del analista" }]);
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='mk_seguimiento' and column_name='agente'")).rows[0].n, 0);
  const args = (await db.query("select pg_get_function_identity_arguments(oid) a from pg_proc where proname='mk_seguimiento_crear'")).rows;
  assert.deepEqual(args.map((x) => x.a), ["p_org uuid, p_user uuid, p_pregunta text, p_frecuencia text, p_primera timestamp with time zone"]);
  const cols = (await db.query("select * from public.mk_seguimiento_reclamar(5)")).fields.map((f) => f.name);
  assert.deepEqual(cols, ["id", "organization_id", "user_id", "pregunta"]);
  await crear(db, U1, "se puede crear otra tras revertir");
});
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas de seguimientos del CMO pasaron"); process.exit(fallos ? 1 : 0);
