// Prueba de la nota del umbral de Instagram contra Postgres en memoria (PGlite). Uso: PGLITE_PATH=<ruta a pglite/dist/index.js> node tools/marketing/prueba_nota_umbral_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH);
const sql = readFileSync(new URL("../../supabase/pendientes/20261115210000_marketing_nota_umbral_instagram.sql", import.meta.url), "utf8");
const rev = readFileSync(new URL("./rollback_nota_umbral_instagram.sql", import.meta.url), "utf8");
const ORG = "a0000000-0000-0000-0000-000000000001", ANTES = "Promedio simple por pieza de la semana, a 7 días.";
async function nuevo(desc = ANTES, version = 1) {
  const db = new PGlite();
  await db.exec(`
    create table public.mk_regla (organization_id uuid, codigo text, version int, parametros jsonb, descripcion text);
    create table public.mk_bitacora (organization_id uuid, agente text check (agente in ('vigilante','revisor','direccion','sistema','informe_diario')), accion text, resultado text, detalle jsonb);
    create table public.mk_regla_historial (id int);`);
  await db.query(`insert into public.mk_regla values ($1,'semaforo_instagram',$2,'{"verde_desde":35,"amarillo_desde":15}',$3), ($1,'semaforo_facebook',1,'{}','otra')`, [ORG, version, desc]);
  return db;
}
const t = async (n, f) => { await f(); console.log("  ok  ", n); };

await t("escribe la nota, deja 35/15 y versión 1, y una sola entrada de bitácora", async () => {
  const db = await nuevo(); await db.exec(sql);
  const r = (await db.query(`select version, parametros, descripcion from public.mk_regla where codigo='semaforo_instagram'`)).rows[0];
  assert.equal(r.version, 1); assert.deepEqual(r.parametros, { verde_desde: 35, amarillo_desde: 15 });
  assert.ok(r.descripcion.startsWith(ANTES + " Nota del 15 nov 2026:")); assert.ok(r.descripcion.includes("mantenerlo"));
  assert.equal((await db.query(`select count(*)::int n from public.mk_bitacora`)).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from public.mk_regla_historial`)).rows[0].n, 0);
  assert.equal((await db.query(`select descripcion from public.mk_regla where codigo='semaforo_facebook'`)).rows[0].descripcion, "otra");
});
await t("si la descripción ya cambió, aborta y no escribe nada (tampoco bitácora)", async () => {
  const db = await nuevo("Otra descripción");
  await assert.rejects(() => db.exec(sql), /no se escribió/);
  assert.equal((await db.query(`select count(*)::int n from public.mk_bitacora`)).rows[0].n, 0);
});
await t("si la regla ya es v2, aborta", async () => { const db = await nuevo(ANTES, 2); await assert.rejects(() => db.exec(sql), /no se escribió/); });
await t("repetirla no duplica la nota (la segunda vez aborta)", async () => {
  const db = await nuevo(); await db.exec(sql); await assert.rejects(() => db.exec(sql), /no se escribió/);
  assert.equal((await db.query(`select count(*)::int n from public.mk_bitacora`)).rows[0].n, 1);
});
await t("la reversa devuelve la descripción original y borra la bitácora", async () => {
  const db = await nuevo(); await db.exec(sql); await db.exec(rev);
  assert.equal((await db.query(`select descripcion from public.mk_regla where codigo='semaforo_instagram'`)).rows[0].descripcion, ANTES);
  assert.equal((await db.query(`select count(*)::int n from public.mk_bitacora`)).rows[0].n, 0);
});
await t("la reversa no toca una descripción distinta", async () => { const db = await nuevo("Otra"); await assert.rejects(() => db.exec(rev), /no es la esperada/); });
console.log("Todas las pruebas de la nota del umbral pasaron");
