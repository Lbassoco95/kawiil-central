// Prueba de la migración 20261115220000_marketing_investigador.sql y de su reversa contra Postgres en memoria (PGlite).
// Uso: PGLITE_PATH=<ruta a pglite/dist/index.js> node tools/marketing/prueba_investigador_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH);
const sql = readFileSync(new URL("../../supabase/pendientes/20261115220000_marketing_investigador.sql", import.meta.url), "utf8");
const rev = readFileSync(new URL("./rollback_investigador.sql", import.meta.url), "utf8");
const ORG = "a0000000-0000-0000-0000-000000000001", REG = "00000000-0000-0000-0000-000000000001";

async function escenario() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE FUNCTION public.mk_can_view() RETURNS boolean LANGUAGE sql AS $$ select true $$;
    CREATE FUNCTION public.mk_org_id() RETURNS uuid LANGUAGE sql AS $$ select '${ORG}'::uuid $$;
    CREATE TABLE public.agent_registry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, display_name text NOT NULL, description text,
      role text NOT NULL, status text NOT NULL DEFAULT 'idle', model text, capabilities jsonb DEFAULT '[]', config jsonb DEFAULT '{}',
      last_heartbeat timestamptz, last_task_at timestamptz, tasks_completed integer DEFAULT 0, tasks_failed integer DEFAULT 0, kind text NOT NULL DEFAULT 'consultable',
      updated_at timestamptz DEFAULT now(), UNIQUE (organization_id, name),
      CONSTRAINT agent_registry_kind_check CHECK (kind = ANY (ARRAY['consultable','system'])),
      CONSTRAINT agent_registry_status_check CHECK (status = ANY (ARRAY['idle','working','resting','error','offline','archived'])));
    CREATE TABLE public.agent_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, agent_id uuid, task_type text, title text, priority text, status text,
      started_at timestamptz, completed_at timestamptz, result jsonb, result_summary text, input_context jsonb);
    INSERT INTO public.agent_registry (organization_id, name, display_name, role, kind) VALUES
      ('${REG}','marketing_cmo','CMO','marketing_cmo','system'), ('${REG}','marketing_vigia','Vigía','marketing_vigia','system'), ('${REG}','coyolli','Coyolli','coyolli','consultable');
  `);
  return db;
}
const t = async (n, f) => { await f(); console.log("  ok  ", n); };
const rechaza = (db, q, re) => assert.rejects(() => db.exec(q), re);
const F = (url, extra = "") => `INSERT INTO public.mk_fuente_web (organization_id, tipo, nombre, url ${extra ? "," + extra.split("=")[0] : ""}) VALUES ('${ORG}','competencia','X','${url}' ${extra ? "," + extra.split("=")[1] : ""})`;

await t("crea las tablas vacías y registra al agente (kind system, sin modelo, solo lectura); aplicarla dos veces no duplica", async () => {
  const db = await escenario(); await db.exec(sql); await db.exec(sql);
  assert.equal((await db.query(`select count(*)::int n from public.mk_fuente_web`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from public.mk_hallazgo_web`)).rows[0].n, 0);
  const a = (await db.query(`select kind, status, model, config, tasks_completed from public.agent_registry where name='marketing_investigador'`)).rows;
  assert.equal(a.length, 1); assert.equal(a[0].kind, "system"); assert.equal(a[0].model, null); assert.equal(a[0].config.solo_lectura, true); assert.equal(a[0].config.cadencia, "bajo_demanda");
  assert.equal((await db.query(`select count(*)::int n from public.agent_registry`)).rows[0].n, 4, "no toca a los demás agentes");
});

await t("restricciones: solo https válido, tipo y formato permitidos, sin duplicar url ni hallazgo, enlace https y resumen corto", async () => {
  const db = await escenario(); await db.exec(sql);
  for (const mala of ["http://a.example.com/", "https://a b.example.com/", "https://sinpunto/", "ftp://a.example.com", "https://a.example.com/x y"]) await rechaza(db, F(mala), /violates check constraint/);
  await db.exec(F("https://a.example.com/")); await rechaza(db, F("https://a.example.com/"), /duplicate key/);
  await rechaza(db, `INSERT INTO public.mk_fuente_web (organization_id, tipo, nombre, url) VALUES ('${ORG}','otro','X','https://b.example.com/')`, /violates check constraint/);
  await rechaza(db, `INSERT INTO public.mk_fuente_web (organization_id, tipo, formato, nombre, url) VALUES ('${ORG}','propio','xml','X','https://c.example.com/')`, /violates check constraint/);
  const id = (await db.query(`select id from public.mk_fuente_web`)).rows[0].id;
  const H = (extra = "") => `INSERT INTO public.mk_hallazgo_web (organization_id, fuente_id, tipo, titulo, resumen, enlace, huella) VALUES ('${ORG}','${id}','nota_nueva','T','${extra}','https://a.example.com/n','h1')`;
  await db.exec(H()); await rechaza(db, H(), /duplicate key/);
  await rechaza(db, `INSERT INTO public.mk_hallazgo_web (organization_id, fuente_id, tipo, titulo, enlace, huella) VALUES ('${ORG}','${id}','nota_nueva','T','http://a.example.com/n','h2')`, /violates check constraint/);
  await rechaza(db, `INSERT INTO public.mk_hallazgo_web (organization_id, fuente_id, tipo, titulo, resumen, enlace, huella) VALUES ('${ORG}','${id}','nota_nueva','T','${"x".repeat(601)}','https://a.example.com/n','h3')`, /violates check constraint/);
  await db.exec(`DELETE FROM public.mk_fuente_web`);
  assert.equal((await db.query(`select count(*)::int n from public.mk_hallazgo_web`)).rows[0].n, 0, "borrar la fuente borra sus hallazgos");
});

await t("permisos: los usuarios solo leen; anon no ve nada; service_role escribe", async () => {
  const db = await escenario(); await db.exec(sql);
  await db.exec(`SET ROLE service_role; ${F("https://a.example.com/")}; RESET ROLE;`);
  await db.exec(`SET ROLE authenticated`);
  assert.equal((await db.query(`select count(*)::int n from public.mk_fuente_web`)).rows[0].n, 1);
  await rechaza(db, F("https://b.example.com/"), /permission denied/);
  await rechaza(db, `UPDATE public.mk_fuente_web SET activa = false`, /permission denied/);
  await rechaza(db, `DELETE FROM public.mk_hallazgo_web`, /permission denied/);
  await db.exec(`RESET ROLE; SET ROLE anon`);
  await rechaza(db, `select * from public.mk_fuente_web`, /permission denied/);
  await rechaza(db, `select * from public.mk_hallazgo_web`, /permission denied/);
  await db.exec(`RESET ROLE`);
});

await t("mk_registrar_corrida y mk_latido_agente aceptan al Investigador, siguen aceptando a los demás y rechazan a un agente no permitido", async () => {
  const db = await escenario(); await db.exec(sql);
  await db.exec(`SELECT public.mk_registrar_corrida('marketing_investigador','completed','Lectura','3 fuentes, 1 hallazgo','{"fuentes":3}'::jsonb)`);
  const a = (await db.query(`select tasks_completed, tasks_failed, last_task_at, status from public.agent_registry where name='marketing_investigador'`)).rows[0];
  assert.equal(a.tasks_completed, 1); assert.equal(a.tasks_failed, 0); assert.ok(a.last_task_at); assert.equal(a.status, "idle");
  await db.exec(`SELECT public.mk_registrar_corrida('marketing_investigador','error','Lectura','falló','{}'::jsonb)`);
  assert.equal((await db.query(`select status, tasks_failed from public.agent_registry where name='marketing_investigador'`)).rows[0].status, "error");
  await db.exec(`SELECT public.mk_registrar_corrida('marketing_cmo','completed','x','y')`); await db.exec(`SELECT public.mk_latido_agente('marketing_investigador')`);
  await rechaza(db, `SELECT public.mk_registrar_corrida('coyolli','completed','x','y')`, /no permitido/);
  await rechaza(db, `SELECT public.mk_latido_agente('coyolli')`, /no permitido/);
  await db.exec(`SET ROLE authenticated`); await rechaza(db, `SELECT public.mk_registrar_corrida('marketing_investigador','completed','x','y')`, /permission denied/); await db.exec(`RESET ROLE`);
});

await t("la reversa borra tablas, tareas y registro del Investigador, devuelve las funciones y no toca a los demás", async () => {
  const db = await escenario(); await db.exec(sql);
  await db.exec(`SELECT public.mk_registrar_corrida('marketing_investigador','completed','x','y')`); await db.exec(`SELECT public.mk_registrar_corrida('marketing_cmo','completed','x','y')`);
  await db.exec(rev);
  assert.equal((await db.query(`select count(*)::int n from public.agent_registry where name='marketing_investigador'`)).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int n from information_schema.tables where table_name in ('mk_fuente_web','mk_hallazgo_web')`)).rows[0].n, 0);
  await rechaza(db, `SELECT public.mk_registrar_corrida('marketing_investigador','completed','x','y')`, /no permitido/);
  await db.exec(`SELECT public.mk_registrar_corrida('marketing_cmo','completed','x','y')`);
  assert.equal((await db.query(`select tasks_completed from public.agent_registry where name='marketing_cmo'`)).rows[0].tasks_completed, 2, "el CMO conserva su historial");
  assert.equal((await db.query(`select count(*)::int n from public.agent_registry`)).rows[0].n, 3);
  await db.exec(sql); // se puede volver a aplicar después de revertir
  assert.equal((await db.query(`select count(*)::int n from public.agent_registry where name='marketing_investigador'`)).rows[0].n, 1);
});
console.log("Todas las pruebas del Investigador pasaron");
