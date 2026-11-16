// Prueba de la REVERSIÓN de la implementación alternativa de «Comunicación interna» (20261116221334 + 20261116223934) contra Postgres en memoria (PGlite).
// Reproduce lo que hay en producción: dos políticas de lectura sobre internal_comunicados, funciones de registro con la lista de agentes (aquí con un agente extra que
// «otra sesión» habría agregado) y usuarios con distintos permisos. Uso: PGLITE_PATH=<ruta a pglite/dist/index.js> node tools/marketing/prueba_comunicacion_interna_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH);
const sql = readFileSync(new URL("./alternativa_comunicacion_interna/20261116221334_aplicada_y_revertida.sql", import.meta.url), "utf8");   // la alternativa, tal como se aplicó
const fix = readFileSync(new URL("./alternativa_comunicacion_interna/20261116223934_listas_agentes.sql", import.meta.url), "utf8");
const rev = readFileSync(new URL(process.env.REVERSION ?? "../../supabase/migrations/20261116225413_marketing_comunicacion_revertir_duplicado.sql", import.meta.url), "utf8");
const cmo = readFileSync(new URL("../../supabase/migrations/20261113015847_marketing_cmo_registro.sql", import.meta.url), "utf8");
const funcionesRegistro = cmo.slice(cmo.indexOf("CREATE OR REPLACE FUNCTION public.mk_registrar_corrida(")).replaceAll("'marketing_cmo')", "'marketing_cmo', 'marketing_otro', 'marketing_comunicacion_interna')");
const A = "a0000000-0000-0000-0000-00000000000a", B = "b0000000-0000-0000-0000-00000000000b", REG = "00000000-0000-0000-0000-000000000001";
const DIR = "11111111-1111-1111-1111-111111111111", MGR = "22222222-2222-2222-2222-222222222222", MIE = "33333333-3333-3333-3333-333333333333", OTRO = "44444444-4444-4444-4444-444444444444";

async function escenario() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE TABLE public.organizations (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, organization_id uuid);
    CREATE TABLE public.user_roles (user_id uuid, role text);
    CREATE TABLE public.user_module_permissions (user_id uuid, module_key text, enabled boolean);
    CREATE FUNCTION public.get_user_org_id(u uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ select organization_id from public.profiles where user_id = u $$;
    CREATE FUNCTION public.is_admin_or_manager(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ select exists (select 1 from public.user_roles where user_id = u and role in ('transformador','referente')) $$;
    CREATE FUNCTION public.mk_can_decide() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ select exists (select 1 from public.user_module_permissions where user_id = auth.uid() and module_key = 'marketing_decidir' and enabled) $$;
    CREATE TABLE public.internal_comunicados (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE, title text NOT NULL, body text,
      is_pinned boolean NOT NULL DEFAULT false, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.internal_comunicados ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Org members can view internal comunicados" ON public.internal_comunicados FOR SELECT TO authenticated USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()));
    CREATE POLICY "Org users see internal_comunicados" ON public.internal_comunicados FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()));
    CREATE POLICY "Admin/manager insert internal_comunicados" ON public.internal_comunicados FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.is_admin_or_manager(auth.uid()));
    CREATE POLICY "Admin/manager delete internal_comunicados" ON public.internal_comunicados FOR DELETE TO authenticated USING (organization_id = public.get_user_org_id(auth.uid()) AND public.is_admin_or_manager(auth.uid()));
    CREATE TABLE public.mk_consulta (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agente text NOT NULL, CONSTRAINT mk_consulta_agente_check CHECK (agente = ANY (ARRAY['marketing_analista'::text, 'marketing_cmo'::text, 'marketing_otro'::text])));
    CREATE TABLE public.agent_registry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, display_name text NOT NULL, description text, role text NOT NULL, status text NOT NULL DEFAULT 'idle',
      model text, capabilities jsonb DEFAULT '[]', config jsonb DEFAULT '{}', last_heartbeat timestamptz, last_task_at timestamptz, tasks_completed integer DEFAULT 0, tasks_failed integer DEFAULT 0,
      kind text NOT NULL DEFAULT 'consultable', updated_at timestamptz DEFAULT now(), UNIQUE (organization_id, name),
      CONSTRAINT agent_registry_kind_check CHECK (kind = ANY (ARRAY['consultable','system'])),
      CONSTRAINT agent_registry_status_check CHECK (status = ANY (ARRAY['idle','working','resting','error','offline','archived'])));
    CREATE TABLE public.agent_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, agent_id uuid, task_type text, title text, priority text, status text,
      started_at timestamptz, completed_at timestamptz, result jsonb, result_summary text, input_context jsonb);
    INSERT INTO public.agent_registry (organization_id, name, display_name, role, kind) VALUES
      ('${REG}','marketing_cmo','CMO','marketing_cmo','system'), ('${REG}','marketing_otro','Otro agente de otra sesión','marketing_otro','system'), ('${REG}','marketing_comunicacion_interna','Comunicación interna (otra sesión)','marketing_comunicacion_interna','system'), ('${REG}','coyolli','Coyolli','coyolli','consultable');
    ${funcionesRegistro}
    INSERT INTO public.organizations VALUES ('${A}'), ('${B}');
    INSERT INTO auth.users VALUES ('${DIR}'), ('${MGR}'), ('${MIE}'), ('${OTRO}');
    INSERT INTO public.profiles VALUES ('${DIR}','${A}'), ('${MGR}','${A}'), ('${MIE}','${A}'), ('${OTRO}','${B}');
    INSERT INTO public.user_roles VALUES ('${MGR}','transformador');
    INSERT INTO public.user_module_permissions VALUES ('${DIR}','marketing_decidir',true), ('${OTRO}','marketing_decidir',true);
    INSERT INTO public.internal_comunicados (organization_id, title, body, is_pinned) VALUES ('${A}','Comunicado de siempre','Texto',true);
  `);
  return db;
}
// Ejecuta sentencias como un usuario de la aplicación (rol authenticated con auth.uid()) y siempre regresa al rol original.
async function como(db, uid, f) {
  await db.exec(`SET ROLE authenticated; SET test.uid = '${uid}'`);
  try { return await f(); } finally { await db.exec(`RESET ROLE; RESET test.uid`); }
}
// Lo que se aplicó en producción: la migración original y luego la corrección de las listas.
const aplicar = async (db) => { await db.exec(sql); await db.exec(fix); };
const t = async (n, f) => { await f(); console.log("  ok  ", n); };
const rechaza = (db, q, re) => assert.rejects(() => db.exec(q), re);
const n = async (db, q) => (await db.query(q)).rows[0].n;
const HOY = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const dia = (d) => { const x = new Date(`${HOY()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };


const estado = async (db) => ({
  agentes: (await db.query(`select name from public.agent_registry where name like 'marketing_com%' order by name`)).rows.map((r) => r.name),
  columnas: (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='internal_comunicados' order by ordinal_position`)).rows.map((r) => r.column_name),
  politicas: (await db.query(`select policyname from pg_policies where tablename='internal_comunicados' and cmd='SELECT' order by policyname`)).rows.map((r) => r.policyname),
  funcionesIc: (await db.query(`select proname from pg_proc where proname like 'ic\\_%' order by proname`)).rows.map((r) => r.proname),
  listas: (await db.query(`select proname, substring(pg_get_functiondef(oid) from 'name IN \\([^)]*\\)') l from pg_proc where proname in ('mk_registrar_corrida','mk_latido_agente') order by proname`)).rows.map((r) => r.l),
  check: (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='mk_consulta_agente_check'`)).rows[0].d,
  acl: (await db.query(`select proacl::text a from pg_proc where proname in ('mk_registrar_corrida','mk_latido_agente') order by proname`)).rows.map((r) => r.a),
});
const ORIGINALES = ["Org members can view internal comunicados", "Org users see internal_comunicados"];
const COLUMNAS_ORIGINALES = ["id", "organization_id", "title", "body", "is_pinned", "created_by", "created_at", "updated_at"];

await t("revertir lo alterno: quita el agente, las columnas, las funciones ic_* y la política nueva; vuelven las dos políticas de lectura y la base queda como estaba antes", async () => {
  const antes = await escenario(); const referencia = await estado(antes);
  const db = await escenario(); await db.exec(sql); await db.exec(fix);
  assert.ok((await estado(db)).agentes.includes("marketing_comunicacion"), "antes de revertir, la alterna está");
  await db.exec(rev);
  assert.deepEqual(await estado(db), referencia, "el estado completo (agentes, columnas, políticas, funciones, listas, check y permisos) es igual al de antes de aplicar lo alterno");
  assert.deepEqual((await estado(db)).columnas, COLUMNAS_ORIGINALES); assert.deepEqual((await estado(db)).politicas, ORIGINALES);
});

await t("el agente de la otra sesión (marketing_comunicacion_interna) y los demás NO se tocan: siguen registrados y aceptados por las funciones de registro", async () => {
  const db = await escenario(); await db.exec(sql); await db.exec(fix); await db.exec(rev);
  for (const ag of ["marketing_comunicacion_interna", "marketing_cmo", "marketing_otro"]) await db.exec(`SELECT public.mk_registrar_corrida('${ag}','completed','t','r'); SELECT public.mk_latido_agente('${ag}')`);
  await assert.rejects(() => db.exec(`SELECT public.mk_registrar_corrida('marketing_comunicacion','completed','t','r')`), /no permitido/);
  await assert.rejects(() => db.exec(`SELECT public.mk_registrar_corrida('coyolli','completed','t','r')`), /no permitido/);
  assert.deepEqual((await estado(db)).agentes, ["marketing_comunicacion_interna"]);
  await db.exec(`INSERT INTO public.mk_consulta (agente) VALUES ('marketing_cmo'), ('marketing_otro')`);
  await assert.rejects(() => db.exec(`INSERT INTO public.mk_consulta (agente) VALUES ('marketing_comunicacion')`), /mk_consulta_agente_check/);
});

await t("es segura donde lo alterno nunca existió (otro entorno): no falla y no cambia nada; y repetirla no cambia nada", async () => {
  const db = await escenario(); const referencia = await estado(db);
  await db.exec(rev); await db.exec(rev);
  assert.deepEqual(await estado(db), referencia);
  const db2 = await escenario(); await db2.exec(sql); await db2.exec(fix); await db2.exec(rev); const una = await estado(db2); await db2.exec(rev);
  assert.deepEqual(await estado(db2), una, "aplicarla dos veces da lo mismo que una");
});

await t("conserva los comunicados que sean de personas y borra solo los del agente alterno", async () => {
  const db = await escenario(); await db.exec(sql); await db.exec(fix);
  await db.exec(`INSERT INTO public.internal_comunicados (organization_id, title, origen, estado) VALUES ('${A}', 'Del agente', 'agente', 'borrador')`);
  await db.exec(rev);
  assert.deepEqual((await db.query(`select title from public.internal_comunicados order by title`)).rows.map((r) => r.title), ["Comunicado de siempre"]);
});
console.log("Todas las pruebas de la reversión de Comunicación interna (duplicada) pasaron");
