// Prueba de la migración 20261116190000_marketing_comunicacion_interna.sql y de su reversa contra Postgres en memoria (PGlite).
// Reproduce lo que hay en producción: dos políticas de lectura sobre internal_comunicados, funciones de registro con la lista de agentes (aquí con un agente extra que
// «otra sesión» habría agregado) y usuarios con distintos permisos. Uso: PGLITE_PATH=<ruta a pglite/dist/index.js> node tools/marketing/prueba_comunicacion_interna_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH);
const sql = readFileSync(new URL("../../supabase/pendientes/20261116190000_marketing_comunicacion_interna.sql", import.meta.url), "utf8");
const rev = readFileSync(new URL("./rollback_comunicacion_interna.sql", import.meta.url), "utf8");
const cmo = readFileSync(new URL("../../supabase/migrations/20261113015847_marketing_cmo_registro.sql", import.meta.url), "utf8");
const funcionesRegistro = cmo.slice(cmo.indexOf("CREATE OR REPLACE FUNCTION public.mk_registrar_corrida(")).replaceAll("'marketing_cmo')", "'marketing_cmo', 'marketing_otro')");
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
      ('${REG}','marketing_cmo','CMO','marketing_cmo','system'), ('${REG}','marketing_otro','Otro agente de otra sesión','marketing_otro','system'), ('${REG}','coyolli','Coyolli','coyolli','consultable');
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
const t = async (n, f) => { await f(); console.log("  ok  ", n); };
const rechaza = (db, q, re) => assert.rejects(() => db.exec(q), re);
const n = async (db, q) => (await db.query(q)).rows[0].n;
const HOY = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const dia = (d) => { const x = new Date(`${HOY()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

await t("lo que ya existía queda igual (publicado, de persona, sin vigencia) y aplicarla dos veces no duplica ni rompe", async () => {
  const db = await escenario(); await db.exec(sql); await db.exec(sql);
  assert.deepEqual((await db.query(`select estado, origen, vigente_desde, vigente_hasta, avisar_al_entrar, aprobado_at, is_pinned from public.internal_comunicados`)).rows,
    [{ estado: "publicado", origen: "persona", vigente_desde: null, vigente_hasta: null, avisar_al_entrar: false, aprobado_at: null, is_pinned: true }]);
  assert.equal(await n(db, `select count(*)::int n from public.agent_registry where name='marketing_comunicacion'`), 1);
});

await t("restricciones: estado y origen válidos, vigencia completa y en orden (máx. un año), avisar exige vigencia y el agente no se publica solo", async () => {
  const db = await escenario(); await db.exec(sql);
  const I = (cols, vals) => `INSERT INTO public.internal_comunicados (organization_id, title, ${cols}) VALUES ('${A}', 'T', ${vals})`;
  await rechaza(db, I("estado", "'aprobado'"), /ic_estado_check/);
  await rechaza(db, I("origen", "'robot'"), /ic_origen_check/);
  await rechaza(db, I("vigente_desde", `'${dia(1)}'`), /ic_vigencia_check/);
  await rechaza(db, I("vigente_desde, vigente_hasta", `'${dia(5)}', '${dia(2)}'`), /ic_vigencia_check/);
  await rechaza(db, I("vigente_desde, vigente_hasta", `'${dia(0)}', '${dia(400)}'`), /ic_vigencia_check/);
  await rechaza(db, I("avisar_al_entrar", "true"), /ic_avisar_requiere_vigencia/);
  await db.exec(I("vigente_desde, vigente_hasta, avisar_al_entrar", `'${dia(1)}', '${dia(1)}', true`));
  await rechaza(db, I("origen, estado", "'agente', 'publicado'"), /ic_agente_requiere_aprobacion/);
  await db.exec(I("origen, estado", "'agente', 'borrador'"));
  await rechaza(db, `INSERT INTO public.internal_comunicados (organization_id, title, origen, estado) VALUES ('${A}', '${"x".repeat(201)}', 'agente', 'borrador')`, /ic_agente_limites/);
  await rechaza(db, `INSERT INTO public.internal_comunicados (organization_id, title, body, origen, estado) VALUES ('${A}', 'T', '${"x".repeat(4001)}', 'agente', 'borrador')`, /ic_agente_limites/);
});

await t("lectura: el equipo ve solo lo publicado; los borradores los ven admin/manager y quien decide; otra organización no ve nada", async () => {
  const db = await escenario(); await db.exec(sql);
  await db.exec(`INSERT INTO public.internal_comunicados (organization_id, title, origen, estado) VALUES ('${A}', 'Borrador', 'agente', 'borrador'), ('${A}', 'Archivado', 'persona', 'archivado')`);
  const titulos = (uid) => como(db, uid, async () => (await db.query(`select title from public.internal_comunicados order by title`)).rows.map((r) => r.title));
  assert.deepEqual(await titulos(MIE), ["Comunicado de siempre"], "un miembro del equipo no ve borradores ni archivados");
  assert.deepEqual(await titulos(MGR), ["Archivado", "Borrador", "Comunicado de siempre"]);
  assert.deepEqual(await titulos(DIR), ["Archivado", "Borrador", "Comunicado de siempre"]);
  assert.deepEqual(await titulos(OTRO), [], "otra organización no ve nada");
});

await t("ic_crear_borrador: solo Dirección; deja borrador de origen agente y valida título, mensaje y fechas", async () => {
  const db = await escenario(); await db.exec(sql);
  const id = await como(db, DIR, async () => (await db.query(`select public.ic_crear_borrador('  Lunes sin trabajo ', 'No se trabaja el lunes.', '${dia(0)}', '${dia(3)}', true) as id`)).rows[0].id);
  assert.deepEqual((await db.query(`select title, body, estado, origen, avisar_al_entrar, created_by, organization_id from public.internal_comunicados where id='${id}'`)).rows[0],
    { title: "Lunes sin trabajo", body: "No se trabaja el lunes.", estado: "borrador", origen: "agente", avisar_al_entrar: true, created_by: DIR, organization_id: A });
  await como(db, MGR, () => rechaza(db, `select public.ic_crear_borrador('X','Y')`, /Solo Dirección/));
  await como(db, MIE, () => rechaza(db, `select public.ic_crear_borrador('X','Y')`, /Solo Dirección/));
  await db.exec(`SET ROLE anon`); await rechaza(db, `select public.ic_crear_borrador('X','Y')`, /permission denied/); await db.exec(`RESET ROLE`);
  await como(db, DIR, async () => {
    await rechaza(db, `select public.ic_crear_borrador('   ','Y')`, /título/);
    await rechaza(db, `select public.ic_crear_borrador('${"x".repeat(201)}','Y')`, /título/);
    await rechaza(db, `select public.ic_crear_borrador('X','${"y".repeat(4001)}')`, /demasiado largo/);
    await rechaza(db, `select public.ic_crear_borrador('X','Y','${dia(1)}',NULL)`, /inicio y de fin/);
    await rechaza(db, `select public.ic_crear_borrador('X','Y',NULL,NULL,true)`, /indicar las fechas/);
    await rechaza(db, `select public.ic_crear_borrador('X','Y','${dia(3)}','${dia(1)}')`, /no es válida/);
  });
});

await t("ic_publicar: solo Dirección, pone aprobador y fecha, no publica vencidos ni dos veces ni de otra organización", async () => {
  const db = await escenario(); await db.exec(sql);
  const borrador = (d1, d2) => como(db, DIR, async () => (await db.query(`select public.ic_crear_borrador('Aviso','Texto','${d1}','${d2}',true) as id`)).rows[0].id);
  const vigente = await borrador(dia(0), dia(2)), vencido = await borrador(dia(-3), dia(-1));
  await como(db, MGR, () => rechaza(db, `select public.ic_publicar('${vigente}')`, /Solo Dirección/));
  await como(db, OTRO, () => rechaza(db, `select public.ic_publicar('${vigente}')`, /No se encontró/));
  await como(db, DIR, async () => {
    await db.exec(`select public.ic_publicar('${vigente}')`);
    await rechaza(db, `select public.ic_publicar('${vigente}')`, /Solo se pueden publicar borradores/);
    await rechaza(db, `select public.ic_publicar('${vencido}')`, /vigencia ya terminó/);
    await rechaza(db, `select public.ic_publicar('00000000-0000-0000-0000-0000000000ff')`, /No se encontró/);
  });
  const r = (await db.query(`select estado, aprobado_por, aprobado_at is not null as con_fecha from public.internal_comunicados where id='${vigente}'`)).rows[0];
  assert.deepEqual(r, { estado: "publicado", aprobado_por: DIR, con_fecha: true });
  assert.equal((await db.query(`select estado from public.internal_comunicados where id='${vencido}'`)).rows[0].estado, "borrador", "el vencido sigue como borrador");
  // un miembro del equipo ya ve el aviso publicado y vigente
  const vistos = await como(db, MIE, async () => (await db.query(`select title from public.internal_comunicados where estado='publicado' and avisar_al_entrar and vigente_desde <= current_date + 1 and vigente_hasta >= current_date order by title`)).rows.map((x) => x.title));
  assert.deepEqual(vistos, ["Aviso"]);
});

await t("ic_archivar e ic_descartar_borrador: solo Dirección, cada una sobre el estado que corresponde", async () => {
  const db = await escenario(); await db.exec(sql);
  const id = async (uid) => como(db, uid, async () => (await db.query(`select public.ic_crear_borrador('A','B') as id`)).rows[0].id);
  const b1 = await id(DIR), b2 = await id(DIR);
  await como(db, DIR, async () => { await db.exec(`select public.ic_publicar('${b1}')`); });
  await como(db, MGR, async () => { await rechaza(db, `select public.ic_archivar('${b1}')`, /Solo Dirección/); await rechaza(db, `select public.ic_descartar_borrador('${b2}')`, /Solo Dirección/); });
  await como(db, DIR, async () => {
    await rechaza(db, `select public.ic_descartar_borrador('${b1}')`, /No se encontró un borrador/);   // ya publicado: no se descarta
    await rechaza(db, `select public.ic_archivar('${b2}')`, /No se encontró un comunicado publicado/); // borrador: no se archiva
    await db.exec(`select public.ic_archivar('${b1}'); select public.ic_descartar_borrador('${b2}')`);
  });
  assert.equal((await db.query(`select estado from public.internal_comunicados where id='${b1}'`)).rows[0].estado, "archivado");
  assert.equal(await n(db, `select count(*)::int n from public.internal_comunicados where id='${b2}'`), 0);
});

await t("el agente queda registrado; las listas de agentes se amplían sin quitar a los demás (ni al «otro» agente) y se conservan los permisos", async () => {
  const db = await escenario(); await db.exec(sql);
  const a = (await db.query(`select kind, status, model, config from public.agent_registry where name='marketing_comunicacion'`)).rows[0];
  assert.equal(a.kind, "system"); assert.equal(a.model, null); assert.equal(a.config.solo_lectura, true); assert.equal(a.config.cadencia, "bajo_demanda");
  for (const ag of ["marketing_comunicacion", "marketing_cmo", "marketing_otro"]) await db.exec(`SELECT public.mk_registrar_corrida('${ag}','completed','t','r'); SELECT public.mk_latido_agente('${ag}')`);
  await rechaza(db, `SELECT public.mk_registrar_corrida('coyolli','completed','t','r')`, /no permitido/);
  await rechaza(db, `SELECT public.mk_latido_agente('coyolli')`, /no permitido/);
  await db.exec(`INSERT INTO public.mk_consulta (agente) VALUES ('marketing_comunicacion'), ('marketing_analista'), ('marketing_cmo'), ('marketing_otro')`);
  await rechaza(db, `INSERT INTO public.mk_consulta (agente) VALUES ('marketing_desconocido')`, /mk_consulta_agente_check/);
  const acl = (await db.query(`select proname, proacl::text acl from pg_proc where proname in ('mk_registrar_corrida','mk_latido_agente') order by proname`)).rows;
  assert.deepEqual(acl.map((x) => x.acl), Array(2).fill("{postgres=X/postgres,service_role=X/postgres}"), "las funciones siguen siendo solo de service_role");
  await db.exec(`SET ROLE authenticated`); await rechaza(db, `SELECT public.mk_registrar_corrida('marketing_comunicacion','completed','t','r')`, /permission denied/); await db.exec(`RESET ROLE`);
});

await t("la reversa quita al agente y sus datos, devuelve las políticas y las listas (conservando a los demás) y deja los comunicados de personas", async () => {
  const db = await escenario(); await db.exec(sql);
  await como(db, DIR, async () => { const id = (await db.query(`select public.ic_crear_borrador('Del agente','X') as id`)).rows[0].id; await db.exec(`select public.ic_publicar('${id}')`); });
  await db.exec(`SELECT public.mk_registrar_corrida('marketing_comunicacion','completed','t','r'); INSERT INTO public.mk_consulta (agente) VALUES ('marketing_comunicacion')`);
  await db.exec(rev);
  assert.equal(await n(db, `select count(*)::int n from public.agent_registry where name='marketing_comunicacion'`), 0);
  assert.equal(await n(db, `select count(*)::int n from public.mk_consulta where agente='marketing_comunicacion'`), 0);
  assert.deepEqual((await db.query(`select title from public.internal_comunicados`)).rows, [{ title: "Comunicado de siempre" }], "se borró lo del agente y se conservó lo de personas");
  assert.equal(await n(db, `select count(*)::int n from information_schema.columns where table_name='internal_comunicados' and column_name in ('estado','origen','vigente_desde','vigente_hasta','avisar_al_entrar','aprobado_por','aprobado_at')`), 0);
  assert.equal(await n(db, `select count(*)::int n from pg_policies where tablename='internal_comunicados' and cmd='SELECT'`), 2, "vuelven las dos políticas de lectura originales");
  assert.equal(await n(db, `select count(*)::int n from pg_proc where proname like 'ic\\_%'`), 0);
  await rechaza(db, `SELECT public.mk_registrar_corrida('marketing_comunicacion','completed','t','r')`, /no permitido/);
  await rechaza(db, `INSERT INTO public.mk_consulta (agente) VALUES ('marketing_comunicacion')`, /mk_consulta_agente_check/);
  for (const ag of ["marketing_cmo", "marketing_otro"]) await db.exec(`SELECT public.mk_registrar_corrida('${ag}','completed','t','r'); SELECT public.mk_latido_agente('${ag}')`);
  await db.exec(`INSERT INTO public.mk_consulta (agente) VALUES ('marketing_otro'), ('marketing_cmo')`);
  assert.equal(await como(db, MIE, async () => await n(db, `select count(*)::int n from public.internal_comunicados`)), 1);
  await db.exec(sql); // se puede volver a aplicar después de revertir
  assert.equal(await n(db, `select count(*)::int n from public.agent_registry where name='marketing_comunicacion'`), 1);
});
console.log("Todas las pruebas de Comunicación interna pasaron");
