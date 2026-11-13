// Prueba de mk_analista_datos y de la migración de registro del Analista contra Postgres real en memoria (PGlite).
//   PGLITE_PATH=<ruta a @electric-sql/pglite/dist/index.js> node tools/marketing/prueba_analista_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const leer = (r) => readFileSync(new URL("../../" + r, import.meta.url), "utf8");
const sqlDatos = leer("supabase/migrations/20261105191631_marketing_analista_datos.sql");
const sqlRegistro = leer("supabase/migrations/20261105194055_marketing_analista_registro.sql");
const sqlAgentes = leer("supabase/migrations/20261104015632_marketing_registrar_agentes.sql");
const sqlRegistrar = leer("supabase/migrations/20261104165545_marketing_registrar_corrida.sql");
const sqlRb1 = leer("tools/marketing/rollback_analista_datos.sql"), sqlRb2 = leer("tools/marketing/rollback_analista_registro.sql");
const sqlCmo = leer("supabase/migrations/20261113015847_marketing_cmo_registro.sql"), sqlRbCmo = leer("tools/marketing/rollback_cmo_registro.sql");
const ORG = "a0000000-0000-0000-0000-000000000001", OTRA = "b0000000-0000-0000-0000-000000000002", GLOBAL = "00000000-0000-0000-0000-000000000001";
let fallos = 0; const prueba = async (n, f) => { try { await f(); console.log("  ok  ", n); } catch (e) { fallos++; console.log("  FALLA", n, "\n       ", e.message); } };

async function base() {
  const db = new PGlite();
  await db.exec(`
    create role service_role; create role anon; create role authenticated;
    create or replace function public.mk_can_view() returns boolean language sql as $$ select true $$;
    create or replace function public.mk_org_id() returns uuid language sql as $$ select '${ORG}'::uuid $$;
    create function mk_semana_inicio(p timestamptz) returns date language sql immutable as $$ select (date_trunc('week', p at time zone 'America/Mexico_City'))::date $$;
    create table mk_pieza (id uuid primary key default gen_random_uuid(), organization_id uuid not null, codigo text, formato text, pilar text, fecha date);
    create table mk_pieza_red (id uuid primary key default gen_random_uuid(), organization_id uuid not null, pieza_id uuid, red text, estado text, publicada_at timestamptz);
    create table mk_resultado (id uuid primary key default gen_random_uuid(), organization_id uuid not null, pieza_red_id uuid, corte text, fuente text, medida text, valor numeric,
      guardados int, compartidos int, clics int, reacciones int, comentarios int, capturado_at timestamptz default now());
    create table mk_calibracion (id uuid primary key default gen_random_uuid(), organization_id uuid not null, semana_inicio date, red text, piezas_calculadas int, promedio_calculado numeric,
      piezas_calendario int, promedio_calendario numeric, color_calculado text, color_calendario text, motivo_gris text, diferencia numeric, nota text);
    create table mk_colchon (id uuid primary key default gen_random_uuid(), organization_id uuid not null, fecha date, red text, ultima_programada date, dias int, color text, tope boolean default false, programadas int, simulada boolean default false, corrida_at timestamptz default now());
    create table mk_caso (id uuid primary key default gen_random_uuid(), organization_id uuid not null, numero int generated always as identity, tipo text, red text, titulo text, estado text default 'abierto', detectado_at timestamptz default now());
    create table mk_informe_diario (id uuid primary key default gen_random_uuid(), organization_id uuid not null, fecha date, contenido jsonb, simulada boolean default false, created_at timestamptz default now());
    create table mk_regla (id uuid primary key default gen_random_uuid(), organization_id uuid not null, codigo text, nombre text, parametros jsonb, activa boolean default true, version int default 1);
    create table mk_cobertura_fuente (id uuid primary key default gen_random_uuid(), organization_id uuid not null, red text, fuente text, desde date, hasta date);
    create table agent_registry (id uuid primary key default gen_random_uuid(), organization_id uuid not null, name text not null, display_name text not null, description text, role text not null,
      status text not null default 'idle', model text, kind text not null default 'consultable', capabilities jsonb default '[]', config jsonb default '{}',
      last_heartbeat timestamptz, last_task_at timestamptz, tasks_completed int default 0, tasks_failed int default 0, updated_at timestamptz default now(),
      unique (organization_id, name), check (kind in ('consultable','system')), check (status in ('idle','working','resting','error','offline','archived')));
    create table agent_tasks (id uuid primary key default gen_random_uuid(), organization_id uuid not null, agent_id uuid references agent_registry(id) on delete set null,
      task_type text not null default 'manual', title text not null, priority text not null default 'normal', status text not null default 'pending',
      started_at timestamptz, completed_at timestamptz, result jsonb, result_summary text, input_context jsonb default '{}',
      check (task_type in ('manual','scheduled','triggered','code_review','analysis','report','question','automation','test')),
      check (status in ('pending','queued','in_progress','waiting_approval','completed','error','cancelled')));
  `);
  await db.exec(sqlAgentes); await db.exec(sqlRegistrar); // los 3 agentes y las dos funciones tal como están en producción
  await db.exec(sqlDatos);
  return db;
}
const q = async (db, s, p) => (await db.query(s, p)).rows;
const herr = async (db, h, e = {}, org = ORG) => (await q(db, "select public.mk_analista_datos($1,$2,$3::jsonb) r", [org, h, JSON.stringify(e)]))[0].r;

async function conDatos() {
  const db = await base();
  const hoy = new Date(); const hace = (d) => new Date(hoy.getTime() - d * 86_400_000).toISOString();
  const pieza = async (org, codigo, formato, pilar, fecha) => (await q(db, "insert into mk_pieza (organization_id,codigo,formato,pilar,fecha) values ($1,$2,$3,$4,$5) returning id", [org, codigo, formato, pilar, fecha]))[0].id;
  const pr = async (org, pieza_id, red, dias) => (await q(db, "insert into mk_pieza_red (organization_id,pieza_id,red,estado,publicada_at) values ($1,$2,$3,'publicada',$4) returning id", [org, pieza_id, red, hace(dias)]))[0].id;
  const res = (org, prid, corte, fuente, valor, g = 0, c = 0, k = 0) => db.query("insert into mk_resultado (organization_id,pieza_red_id,corte,fuente,medida,valor,guardados,compartidos,clics,reacciones,comentarios) values ($1,$2,$3,$4,'alcance',$5,$6,$7,$8,0,0)", [org, prid, corte, fuente, valor, g, c, k]);
  const p1 = await pieza(ORG, "C-1", "Carrusel", "PLD", null), p2 = await pieza(ORG, "C-2", "Imagen única", "PLD", null), p3 = await pieza(ORG, "C-3", "Carrusel", "RCG", null);
  const a = await pr(ORG, p1, "instagram", 10), b = await pr(ORG, p2, "instagram", 11), c = await pr(ORG, p3, "linkedin", 12);
  await res(ORG, a, "7d", "metricool", 1000, 10, 4, 6); await res(ORG, a, "acumulado", "metricool", 1500, 12, 5, 7); // MISMA pieza con 7d y acumulado: debe contar UNA vez, con el 7d
  await res(ORG, b, "acumulado", "calendario_maestro", 500, 2, 1, 0);
  await res(ORG, c, "7d", "metricool", null, 0, 0, 0); await res(ORG, c, "acumulado", "metricool", 300, 3, 0, 1); // el 7d nulo no gana
  const otra = await pieza(OTRA, "X-1", "Carrusel", "PLD", null); const o = await pr(OTRA, otra, "instagram", 10); await res(OTRA, o, "7d", "metricool", 99999);
  await db.query("insert into mk_colchon (organization_id,fecha,red,ultima_programada,dias,color,programadas,simulada,corrida_at) values ($1,'2026-11-04','instagram','2026-11-25',21,'verde',13,false,$2),($1,'2026-11-05','instagram','2026-11-25',20,'verde',13,false,$3),($1,'2026-11-05','instagram','2026-12-30',55,'verde',99,true,$4)", [ORG, hace(2), hace(1), hace(0)]);
  await db.query("insert into mk_caso (organization_id,tipo,red,titulo,estado) values ($1,'investigacion','instagram','Caso 1','abierto'),($1,'colchon','facebook','Cerrado','cerrado'),($2,'otro',null,'Ajeno','abierto')", [ORG, OTRA]);
  await db.query("insert into mk_informe_diario (organization_id,fecha,contenido,simulada) values ($1,'2026-11-04','{\"faltantes\":[{\"codigo\":\"C-9\",\"fecha\":\"2026-11-10\",\"hora\":\"11:00\",\"redes\":[\"instagram\"]}],\"con_error\":[],\"desconocidos\":[],\"piezas_calendario_en_ventana\":5,\"necesita_direccion\":[\"texto largo que NO debe salir\"]}',false),($1,'2026-11-05','{\"faltantes\":[],\"con_error\":[],\"desconocidos\":[],\"piezas_calendario_en_ventana\":6}',false),($1,'2026-11-06','{\"faltantes\":[1,2,3]}',true)", [ORG]);
  await db.query("insert into mk_regla (organization_id,codigo,nombre,parametros,activa) values ($1,'colchon','Colchón','{\"verde_desde\":14}',true),($1,'vieja','Vieja','{}',false)", [ORG]);
  await db.query("insert into mk_cobertura_fuente (organization_id,red,fuente,desde,hasta) values ($1,'instagram','metricool','2026-09-08','2026-11-05')", [ORG]);
  await db.query("insert into mk_calibracion (organization_id,semana_inicio,red,piezas_calculadas,promedio_calculado,color_calculado,color_calendario) values ($1,$2,'instagram',3,1000,'verde','verde')", [ORG, new Date(hoy.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)]);
  return db;
}

await prueba("lista cerrada: herramienta desconocida, red inválida y organización nula se rechazan", async () => {
  const db = await base();
  await assert.rejects(() => herr(db, "borrar_todo"), /herramienta no permitida/);
  await assert.rejects(() => herr(db, "colchon_actual", { red: "tiktok" }), /red no válida/);
  await assert.rejects(() => herr(db, "colchon_actual", {}, null), /falta la organización/);
});
await prueba("colchon_actual: la última lectura REAL por red (ignora la simulada y la más vieja)", async () => {
  const r = await herr(await conDatos(), "colchon_actual");
  assert.equal(r.datos.length, 1); assert.deepEqual([r.datos[0].red, r.datos[0].dias, r.datos[0].programadas], ["instagram", 20, 13]);
  assert.ok(r.corte);
});
await prueba("resultados: una pieza con 7d Y acumulado cuenta UNA vez y con el valor del 7d; el 7d nulo no gana; no mezcla otra organización", async () => {
  const r = await herr(await conDatos(), "resultados_por_formato", { dias: 90 });
  const g = (red, grupo) => r.datos.find((x) => x.red === red && x.grupo === grupo);
  assert.deepEqual([g("instagram", "Carrusel").piezas, Number(g("instagram", "Carrusel").valor_promedio)], [1, 1000], "7d (1000) y no el acumulado (1500), una sola pieza");
  assert.equal(Number(g("instagram", "Carrusel").guardados_promedio), 10);
  assert.equal(Number(g("linkedin", "Carrusel").valor_promedio), 300, "el 7d nulo no gana al acumulado");
  assert.ok(!JSON.stringify(r).includes("99999"), "no entra la otra organización");
  assert.equal(r.datos.reduce((s, x) => s + x.piezas, 0), 3);
});
await prueba("resultados_por_pilar y resultados_semanales agrupan bien y respetan la red y el rango", async () => {
  const db = await conDatos();
  const pil = await herr(db, "resultados_por_pilar", { red: "instagram" });
  assert.deepEqual(pil.datos.map((x) => [x.grupo, x.piezas]).sort(), [["PLD", 2]]);
  const sem = await herr(db, "resultados_semanales", { semanas: 4 });
  assert.ok(sem.datos.length >= 1); assert.ok(sem.datos.every((x) => ["instagram", "linkedin"].includes(x.red)));
  assert.equal(sem.datos.reduce((s, x) => s + x.piezas, 0), 3);
  assert.equal((await herr(db, "resultados_semanales", { semanas: 4, red: "facebook" })).datos.length, 0);
});
await prueba("parámetros acotados: semanas/días absurdos no rompen ni devuelven más de 60 filas", async () => {
  const db = await conDatos();
  for (const e of [{ semanas: 99999 }, { semanas: -5 }, { dias: 100000 }, { dias: 0 }]) assert.ok((await herr(db, "resultados_semanales", e)).datos.length <= 60);
});
await prueba("casos_abiertos: solo los abiertos de la organización", async () => {
  const r = await herr(await conDatos(), "casos_abiertos");
  assert.deepEqual(r.datos.map((x) => x.titulo), ["Caso 1"]);
});
await prueba("informe_hoy: el último informe REAL, con conteos y sin los textos de recomendación; sin informes devuelve {}", async () => {
  const db = await conDatos();
  const r = await herr(db, "informe_hoy");
  assert.equal(r.datos.fecha, "2026-11-05"); assert.equal(r.datos.faltantes, 0); assert.equal(r.datos.piezas_en_ventana, 6);
  await db.exec("delete from mk_informe_diario where fecha = '2026-11-05'");
  const r2 = await herr(db, "informe_hoy"); assert.equal(r2.datos.fecha, "2026-11-04"); assert.equal(r2.datos.piezas_faltantes[0].codigo, "C-9");
  assert.ok(!JSON.stringify(r2).includes("NO debe salir"));
  await db.exec("delete from mk_informe_diario"); assert.deepEqual((await herr(db, "informe_hoy")).datos, {});
});
await prueba("reglas_vigentes (solo activas), cobertura_fuentes, semaforo_semanas y piezas_proximas responden", async () => {
  const db = await conDatos();
  assert.deepEqual((await herr(db, "reglas_vigentes")).datos.map((x) => x.codigo), ["colchon"]);
  assert.equal((await herr(db, "cobertura_fuentes")).datos[0].desde, "2026-09-08");
  assert.equal((await herr(db, "semaforo_semanas", { semanas: 4 })).datos.length, 1);
  assert.deepEqual((await herr(db, "piezas_proximas")).datos, []);
});
await prueba("permisos: solo service_role ejecuta mk_analista_datos (anon y authenticated no)", async () => {
  const db = await base();
  for (const rol of ["anon", "authenticated", "service_role"]) assert.equal((await q(db, `select has_function_privilege('${rol}','public.mk_analista_datos(uuid,text,jsonb)','execute') p`))[0].p, rol === "service_role", rol);
});
await prueba("registro: el Analista queda como agente de sistema; las dos funciones lo aceptan; los demás agentes y rechazos siguen igual", async () => {
  const db = await base(); await db.exec(sqlRegistro); await db.exec(sqlRegistro); // idempotente
  const a = (await q(db, "select kind,status,model,config from agent_registry where name='marketing_analista'"))[0];
  assert.deepEqual([a.kind, a.status, a.model], ["system", "idle", null]); assert.equal(a.config.solo_lectura, true);
  assert.equal((await q(db, "select count(*)::int n from agent_registry where name='marketing_analista'"))[0].n, 1);
  const [{ id }] = await q(db, "select public.mk_registrar_corrida('marketing_analista','completed','Pregunta','cifras citadas','{}'::jsonb) id");
  assert.equal((await q(db, "select task_type, input_context->>'origen' o from agent_tasks where id=$1", [id]))[0].o, "marketing");
  await db.query("select public.mk_latido_agente('marketing_analista')");
  assert.equal((await q(db, "select tasks_completed from agent_registry where name='marketing_analista'"))[0].tasks_completed, 1);
  await assert.rejects(() => db.query("select public.mk_registrar_corrida('coyolli','completed','x','y')"), /no permitido/);
  await db.query("select public.mk_registrar_corrida('marketing_vigilante','completed','x','y')"); // los originales siguen funcionando
});
await prueba("mk_consulta: restricciones, RLS y permisos (solo lectura para authenticated, nada para anon)", async () => {
  const db = await base(); await db.exec(sqlRegistro);
  const ins = (o = {}) => db.query("insert into mk_consulta (organization_id,user_id,pregunta,estado) values ($1,gen_random_uuid(),$2,$3)", [ORG, o.p ?? "¿cómo vamos?", o.e ?? "respondida"]);
  await ins();
  await assert.rejects(() => ins({ p: "ab" }), /check/); await assert.rejects(() => ins({ p: "x".repeat(501) }), /check/); await assert.rejects(() => ins({ e: "otro" }), /check/);
  const t = (rol, p) => q(db, `select has_table_privilege('${rol}','public.mk_consulta','${p}') x`).then((r) => r[0].x);
  assert.equal(await t("anon", "select"), false); assert.equal(await t("authenticated", "select"), true); assert.equal(await t("authenticated", "insert"), false);
  assert.equal(await t("authenticated", "update"), false); assert.equal(await t("authenticated", "delete"), false); assert.equal(await t("service_role", "insert"), true);
  assert.equal((await q(db, "select relrowsecurity r from pg_class where relname='mk_consulta'"))[0].r, true);
});
await prueba("reversas: borran las funciones y el registro del Analista sin tocar a los otros tres", async () => {
  const db = await base(); await db.exec(sqlRegistro); await db.exec(sqlRb1);
  assert.equal((await q(db, "select count(*)::int n from pg_proc where proname='mk_analista_datos'"))[0].n, 0);
  await db.query("select public.mk_registrar_corrida('marketing_analista','completed','t','r')"); await db.exec(sqlRb2);
  assert.equal((await q(db, "select count(*)::int n from agent_registry where kind='system'"))[0].n, 3);
  assert.equal((await q(db, "select count(*)::int n from agent_tasks"))[0].n, 0);
  assert.equal((await q(db, "select count(*)::int n from pg_class where relname='mk_consulta'"))[0].n, 0);
});
await prueba("CMO: se registra como agente de sistema; las funciones lo aceptan; mk_consulta guarda con qué agente se habló; idempotente", async () => {
  const db = await base(); await db.exec(sqlRegistro); await db.exec(sqlCmo); await db.exec(sqlCmo);
  const a = (await q(db, "select kind,status,model,config from agent_registry where name='marketing_cmo'"))[0];
  assert.deepEqual([a.kind, a.status, a.model], ["system", "idle", null]); assert.equal(a.config.solo_lectura, true); assert.equal(a.config.cadencia, "bajo_demanda");
  assert.equal((await q(db, "select count(*)::int n from agent_registry where name='marketing_cmo'"))[0].n, 1);
  await db.query("select public.mk_registrar_corrida('marketing_cmo','completed','Consulta al CMO','cifras citadas')"); await db.query("select public.mk_latido_agente('marketing_cmo')");
  assert.equal((await q(db, "select tasks_completed from agent_registry where name='marketing_cmo'"))[0].tasks_completed, 1);
  const ins = (ag) => db.query("insert into mk_consulta (organization_id,user_id,agente,pregunta,estado) values ($1,gen_random_uuid(),$2,'¿qué priorizamos?','respondida')", [ORG, ag]);
  await ins("marketing_cmo"); await ins("marketing_analista"); await assert.rejects(() => ins("otro_agente"), /check/);
  assert.equal((await q(db, "select agente from mk_consulta where agente='marketing_cmo'")).length, 1);
});
await prueba("CMO: los demás agentes y rechazos siguen igual; permisos de las funciones intactos", async () => {
  const db = await base(); await db.exec(sqlRegistro); await db.exec(sqlCmo);
  for (const n of ["marketing_vigilante", "marketing_informe_diario", "marketing_vigia", "marketing_analista"]) await db.query("select public.mk_registrar_corrida($1,'completed','x','y')", [n]);
  await assert.rejects(() => db.query("select public.mk_registrar_corrida('coyolli','completed','x','y')"), /no permitido/);
  await assert.rejects(() => db.query("select public.mk_latido_agente('marketing_otro')"), /no permitido/);
  for (const f of ["mk_registrar_corrida(text,text,text,text,jsonb,timestamptz)", "mk_latido_agente(text)"])
    for (const rol of ["anon", "authenticated", "service_role"]) assert.equal((await q(db, `select has_function_privilege('${rol}','public.${f}','execute') p`))[0].p, rol === "service_role", `${f} ${rol}`);
  const t = (rol, p) => q(db, `select has_table_privilege('${rol}','public.mk_consulta','${p}') x`).then((r) => r[0].x);
  assert.equal(await t("anon", "select"), false); assert.equal(await t("authenticated", "insert"), false);
});
await prueba("CMO: la reversa lo quita (con sus consultas y tareas) y deja al Analista y a los otros tres como estaban", async () => {
  const db = await base(); await db.exec(sqlRegistro); await db.exec(sqlCmo);
  await db.query("select public.mk_registrar_corrida('marketing_cmo','completed','t','r')"); await db.query("select public.mk_registrar_corrida('marketing_analista','completed','t','r')");
  await db.query("insert into mk_consulta (organization_id,user_id,agente,pregunta,estado) values ($1,gen_random_uuid(),'marketing_cmo','¿qué priorizamos?','respondida'),($1,gen_random_uuid(),'marketing_analista','¿cómo vamos?','respondida')", [ORG]);
  await db.exec(sqlRbCmo);
  assert.equal((await q(db, "select count(*)::int n from agent_registry where name='marketing_cmo'"))[0].n, 0);
  assert.equal((await q(db, "select count(*)::int n from agent_registry where kind='system'"))[0].n, 4);
  assert.equal((await q(db, "select count(*)::int n from mk_consulta"))[0].n, 1); assert.equal((await q(db, "select count(*)::int n from agent_tasks"))[0].n, 1);
  await assert.rejects(() => db.query("select public.mk_registrar_corrida('marketing_cmo','completed','t','r')"), /no permitido/);
  await db.query("select public.mk_registrar_corrida('marketing_analista','completed','t','r')");
  await assert.rejects(() => db.query("insert into mk_consulta (organization_id,user_id,agente,pregunta,estado) values ($1,gen_random_uuid(),'marketing_cmo','¿qué priorizamos?','respondida')", [ORG]), /check/);
});
if (fallos) { console.log(`\n${fallos} prueba(s) fallaron`); process.exit(1); }
console.log("\nTodas las pruebas del Analista (SQL) pasaron");
