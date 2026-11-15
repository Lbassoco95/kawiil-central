// Prueba de la corrección de mk_semaforo_semana contra un Postgres real en memoria (PGlite), comparándola con la función ACTUAL
// de producción (copiada tal cual, renombrada a _viejo). Las tablas son réplicas mínimas (mismas columnas relevantes); mk_semana_inicio
// es una réplica de su comportamiento documentado (semana de lunes a domingo, hora de Ciudad de México).
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   PGLITE_PATH=/tmp/pg/node_modules/@electric-sql/pglite/dist/index.js node tools/marketing/prueba_semaforo_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const nueva = readFileSync(new URL("../../supabase/migrations/20261115192905_marketing_semaforo_corregido.sql", import.meta.url), "utf8");
const recalcular = readFileSync(new URL("../../supabase/migrations/20261115193119_marketing_recalcular_semaforo.sql", import.meta.url), "utf8");
const rbRecalcular = readFileSync(new URL("./rollback_recalcular_semaforo.sql", import.meta.url), "utf8"), rbCorregido = readFileSync(new URL("./rollback_semaforo_corregido.sql", import.meta.url), "utf8");

const VIEJA = `
CREATE OR REPLACE FUNCTION public.mk_semaforo_semana_viejo(p_org uuid, p_semana date, p_red text, p_fuente text DEFAULT 'metricool'::text)
 RETURNS TABLE(piezas integer, promedio numeric, color text, motivo_gris text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_verde numeric; v_amarillo numeric; v_n integer; v_prom numeric; v_cubierta boolean;
BEGIN
  SELECT (parametros->>'verde_desde')::numeric, (parametros->>'amarillo_desde')::numeric INTO v_verde, v_amarillo
  FROM public.mk_regla WHERE organization_id = p_org AND codigo = 'semaforo_' || p_red AND activa;
  SELECT count(*), avg(res.valor) INTO v_n, v_prom
  FROM public.mk_pieza p
  JOIN public.mk_pieza_red r ON r.pieza_id = p.id AND r.red = p_red AND r.estado = 'publicada'
  LEFT JOIN public.mk_resultado res ON res.pieza_red_id = r.id AND res.corte IN ('7d', 'acumulado') AND res.fuente = p_fuente
  WHERE p.organization_id = p_org AND p.primera_publicacion_at IS NOT NULL AND public.mk_semana_inicio(p.primera_publicacion_at) = p_semana;
  SELECT EXISTS (SELECT 1 FROM public.mk_cobertura_fuente c WHERE c.organization_id = p_org AND c.red = p_red AND c.fuente = p_fuente
      AND c.desde <= p_semana + 6 AND c.hasta >= p_semana) INTO v_cubierta;
  RETURN QUERY SELECT v_n, v_prom,
    CASE WHEN v_n = 0 OR v_prom IS NULL OR v_verde IS NULL THEN 'gris' WHEN v_prom >= v_verde THEN 'verde' WHEN v_prom >= v_amarillo THEN 'amarillo' ELSE 'rojo' END,
    CASE WHEN v_n > 0 AND v_prom IS NOT NULL AND v_verde IS NOT NULL THEN NULL WHEN NOT v_cubierta THEN 'sin_datos_fuente' ELSE 'sin_piezas_publicadas' END;
END; $function$;`;

const ORG = "a0000000-0000-0000-0000-000000000001", SEMANA = "2026-11-02"; // lunes
const db = new PGlite();
await db.exec(`
  create role service_role; create role anon; create role authenticated;
  create table mk_regla (organization_id uuid, codigo text, parametros jsonb, activa boolean default true);
  create table mk_pieza (id uuid primary key default gen_random_uuid(), organization_id uuid, primera_publicacion_at timestamptz);
  create table mk_pieza_red (id uuid primary key default gen_random_uuid(), pieza_id uuid references mk_pieza(id), red text, estado text);
  create table mk_resultado (id uuid primary key default gen_random_uuid(), pieza_red_id uuid references mk_pieza_red(id), corte text check (corte in ('48h','7d','acumulado')),
    fuente text check (fuente in ('metricool','calendario_maestro')), valor numeric, unique (pieza_red_id, corte, fuente));
  create table mk_cobertura_fuente (organization_id uuid, red text, fuente text, desde date, hasta date);
  create table mk_calibracion (id uuid primary key default gen_random_uuid(), organization_id uuid not null, semana_inicio date not null, red text not null check (red in ('instagram','facebook','linkedin')),
    piezas_calculadas integer, promedio_calculado numeric, piezas_calendario integer, promedio_calendario numeric, color_calculado text, color_calendario text,
    motivo_gris text, diferencia numeric, nota text, calculado_at timestamptz not null default now(), unique (organization_id, semana_inicio, red));
  create table mk_bitacora (id uuid primary key default gen_random_uuid(), organization_id uuid not null,
    agente text not null check (agente in ('vigilante','revisor','direccion','sistema','informe_diario')), accion text not null, resultado text not null, detalle jsonb, caso_id uuid, registrado_at timestamptz not null default now());
  create function public.mk_semana_inicio(ts timestamptz) returns date language sql immutable as $$ select date_trunc('week', ts at time zone 'America/Mexico_City')::date $$;
  insert into mk_regla values ('${ORG}','semaforo_instagram','{"verde_desde":35,"amarillo_desde":15}'), ('${ORG}','semaforo_facebook','{"verde_desde":18,"amarillo_desde":10}');
`);
await db.exec(VIEJA); await db.exec(nueva); await db.exec(recalcular);

let n = 0, fallos = 0;
const prueba = async (nombre, fn) => { try { await db.exec("truncate mk_resultado, mk_pieza_red, mk_pieza, mk_cobertura_fuente, mk_calibracion, mk_bitacora cascade"); await fn(); console.log("  ok  ", nombre); } catch (e) { fallos++; console.log("  FALLA", nombre, "\n       ", e.message); } };
// crea una pieza publicada del día 2026-11-04 con resultados [{corte, fuente, valor}]; devuelve el id de pieza_red
async function pieza(red, resultados, { estado = "publicada", dia = "2026-11-04T18:00:00Z" } = {}) {
  const p = (await db.query("insert into mk_pieza (organization_id, primera_publicacion_at) values ($1,$2) returning id", [ORG, dia])).rows[0].id;
  const r = (await db.query("insert into mk_pieza_red (pieza_id, red, estado) values ($1,$2,$3) returning id", [p, red, estado])).rows[0].id;
  for (const x of resultados) await db.query("insert into mk_resultado (pieza_red_id, corte, fuente, valor) values ($1,$2,$3,$4)", [r, x.corte, x.fuente ?? "metricool", x.valor]);
  return r;
}
const v = async (fn, red = "instagram", fuente = "metricool", semana = SEMANA) => (await db.query(`select * from public.${fn}($1,$2,$3,$4)`, [ORG, semana, red, fuente])).rows[0];
const num = (x) => (x.promedio === null ? null : Number(Number(x.promedio).toFixed(4)));

await prueba("LA PRUEBA PEDIDA: una pieza con corte de 7 días Y acumulado a la vez ya no cuenta dos veces (la actual sí)", async () => {
  await pieza("instagram", [{ corte: "7d", valor: 20 }, { corte: "acumulado", valor: 100 }]); // A: 7d=20, acumulado (sigue creciendo)=100
  await pieza("instagram", [{ corte: "acumulado", valor: 10 }]);                              // B: solo acumulado
  const viejo = await v("mk_semaforo_semana_viejo"), nuevo = await v("mk_semaforo_semana");
  assert.equal(viejo.piezas, 3);                       // defecto: la pieza A cuenta dos veces
  assert.equal(num(viejo), 43.3333); assert.equal(viejo.color, "verde");
  assert.equal(nuevo.piezas, 2);                       // corregido: una fila por pieza
  assert.equal(num(nuevo), 15); assert.equal(nuevo.color, "amarillo"); // 7d de A (20) y acumulado de B (10) → promedio 15 → amarillo (≥15)
  assert.equal(nuevo.motivo_gris, null);
});
await prueba("con el 7d presente se usa el 7d aunque el acumulado sea mayor, y a la inversa", async () => {
  await pieza("instagram", [{ corte: "7d", valor: 200 }, { corte: "acumulado", valor: 50 }]);
  const x = await v("mk_semaforo_semana"); assert.equal(x.piezas, 1); assert.equal(num(x), 200);
});
await prueba("HOY (solo 'acumulado', como los 121 resultados del Calendario Maestro): idéntica a la actual en piezas, promedio, color y motivo", async () => {
  for (const val of [5, 12, 30, 44, 60, 0]) await pieza("instagram", [{ corte: "acumulado", fuente: "calendario_maestro", valor: val }]);
  for (const val of [9, 18, 40]) await pieza("facebook", [{ corte: "acumulado", fuente: "calendario_maestro", valor: val }]);
  for (const [red, fuente] of [["instagram", "calendario_maestro"], ["facebook", "calendario_maestro"], ["instagram", "metricool"]]) {
    const a = await v("mk_semaforo_semana_viejo", red, fuente), b = await v("mk_semaforo_semana", red, fuente);
    assert.deepEqual([b.piezas, num(b), b.color, b.motivo_gris], [a.piezas, num(a), a.color, a.motivo_gris], `${red}/${fuente}`);
  }
});
await prueba("solo corte 7d: igual que la actual", async () => {
  await pieza("instagram", [{ corte: "7d", valor: 40 }]); await pieza("instagram", [{ corte: "7d", valor: 20 }]);
  const a = await v("mk_semaforo_semana_viejo"), b = await v("mk_semaforo_semana"); assert.deepEqual([b.piezas, num(b), b.color], [a.piezas, num(a), a.color]);
});
await prueba("un 7d con valor nulo no tapa un acumulado que sí tiene valor", async () => {
  await pieza("instagram", [{ corte: "7d", valor: null }, { corte: "acumulado", valor: 60 }]);
  const x = await v("mk_semaforo_semana"); assert.equal(x.piezas, 1); assert.equal(num(x), 60); assert.equal(x.color, "verde");
});
await prueba("una pieza sin resultados cuenta en el número de piezas pero no mueve el promedio (como antes)", async () => {
  await pieza("instagram", [{ corte: "acumulado", valor: 40 }]); await pieza("instagram", []);
  const a = await v("mk_semaforo_semana_viejo"), b = await v("mk_semaforo_semana");
  assert.deepEqual([b.piezas, num(b)], [2, 40]); assert.deepEqual([a.piezas, num(a)], [2, 40]);
});
await prueba("las fuentes no se mezclan: con p_fuente=metricool solo cuentan los resultados de metricool", async () => {
  await pieza("instagram", [{ corte: "acumulado", fuente: "calendario_maestro", valor: 999 }, { corte: "7d", fuente: "metricool", valor: 30 }]);
  const x = await v("mk_semaforo_semana", "instagram", "metricool"); assert.equal(num(x), 30);
  const y = await v("mk_semaforo_semana", "instagram", "calendario_maestro"); assert.equal(num(y), 999);
});
await prueba("piezas no publicadas, de otra semana o de otra red no cuentan", async () => {
  await pieza("instagram", [{ corte: "acumulado", valor: 50 }], { estado: "con_errores" });
  await pieza("instagram", [{ corte: "acumulado", valor: 50 }], { dia: "2026-10-28T18:00:00Z" });
  await pieza("facebook", [{ corte: "acumulado", valor: 50 }]);
  const x = await v("mk_semaforo_semana"); assert.equal(x.piezas, 0); assert.equal(x.color, "gris");
});
await prueba("los motivos de gris no cambian (con y sin cobertura de la fuente)", async () => {
  let a = await v("mk_semaforo_semana_viejo"), b = await v("mk_semaforo_semana"); assert.equal(b.motivo_gris, "sin_datos_fuente"); assert.equal(a.motivo_gris, b.motivo_gris);
  await db.query("insert into mk_cobertura_fuente values ($1,'instagram','metricool','2026-10-01','2026-11-30')", [ORG]);
  a = await v("mk_semaforo_semana_viejo"); b = await v("mk_semaforo_semana"); assert.equal(b.motivo_gris, "sin_piezas_publicadas"); assert.equal(a.motivo_gris, b.motivo_gris);
});
await prueba("propiedad: con una fila de resultado por pieza (sin duplicados), la nueva y la actual coinciden SIEMPRE (300 casos aleatorios)", async () => {
  let s = 7; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let caso = 0; caso < 300; caso++) {
    await db.exec("truncate mk_resultado, mk_pieza_red, mk_pieza cascade");
    const k = 1 + Math.floor(r() * 6);
    for (let i = 0; i < k; i++) await pieza(r() < 0.5 ? "instagram" : "facebook", r() < 0.15 ? [] : [{ corte: r() < 0.5 ? "7d" : "acumulado", valor: r() < 0.1 ? null : Math.floor(r() * 80) }], { estado: r() < 0.9 ? "publicada" : "con_errores" });
    for (const red of ["instagram", "facebook"]) {
      const a = await v("mk_semaforo_semana_viejo", red), b = await v("mk_semaforo_semana", red);
      assert.deepEqual([b.piezas, num(b), b.color, b.motivo_gris], [a.piezas, num(a), a.color, a.motivo_gris], `caso ${caso} ${red}`);
    }
  }
});
await prueba("permisos: el archivo cierra la función a anon/authenticated y la deja a service_role; no cambia el nombre ni los argumentos", async () => {
  assert.match(nueva, /REVOKE ALL ON FUNCTION public\.mk_semaforo_semana\(uuid, date, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(nueva, /GRANT EXECUTE ON FUNCTION public\.mk_semaforo_semana\(uuid, date, text, text\) TO service_role/);
  assert.match(nueva, /CREATE OR REPLACE FUNCTION public\.mk_semaforo_semana\(p_org uuid, p_semana date, p_red text, p_fuente text DEFAULT 'metricool'::text\)/);
});

// ── mk_recalcular_semaforo ──────────────────────────────────────────────────────────────────────────────────────────────
const LUN1 = "2026-10-26", LUN2 = "2026-11-02"; // dos lunes seguidos
const dia = (lunes, h = "18:00:00Z") => `${lunes}T${h}`;
const rec = async (desde = LUN1, hasta = LUN2, redes = ["instagram"], fuente = "metricool") => (await db.query("select public.mk_recalcular_semaforo($1,$2,$3,$4::text[],$5) r", [ORG, desde, hasta, redes, fuente])).rows[0].r;
const fila = async (semana, red = "instagram") => (await db.query("select * from mk_calibracion where organization_id=$1 and semana_inicio=$2 and red=$3", [ORG, semana, red])).rows[0];
const sembrar = (semana, red, o = {}) => db.query(`insert into mk_calibracion (organization_id, semana_inicio, red, piezas_calculadas, promedio_calculado, piezas_calendario, promedio_calendario, color_calculado, color_calendario, motivo_gris, diferencia, nota)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [ORG, semana, red, o.pc ?? 0, o.prom ?? null, o.pcal ?? null, o.pro_cal ?? null, o.color ?? "gris", o.ccal ?? null, o.gris ?? "sin_datos_fuente", o.dif ?? null, o.nota ?? "nota original"]);

await prueba("recalcular: escribe solo lo calculado con la fuente pedida y CONSERVA las columnas del archivo y la nota anterior", async () => {
  await db.query("insert into mk_cobertura_fuente values ($1,'instagram','metricool','2026-10-01','2026-11-30')", [ORG]);
  await pieza("instagram", [{ corte: "acumulado", fuente: "metricool", valor: 40 }, { corte: "acumulado", fuente: "calendario_maestro", valor: 10 }], { dia: dia(LUN1) });
  await sembrar(LUN1, "instagram", { pc: 1, prom: 10, color: "amarillo", gris: null, pcal: 1, pro_cal: 12, ccal: "amarillo", nota: "Lectura provisional" });
  const r = await rec(LUN1, LUN1);
  const f = await fila(LUN1);
  assert.deepEqual([f.piezas_calculadas, Number(f.promedio_calculado), f.color_calculado, f.motivo_gris], [1, 40, "verde", null]);
  assert.deepEqual([f.piezas_calendario, Number(f.promedio_calendario), f.color_calendario], [1, 12, "amarillo"]);   // columnas del archivo intactas
  assert.equal(Number(f.diferencia), 28); assert.match(f.nota, /^Recalculado con metricool/); assert.match(f.nota, /Antes: Lectura provisional/);
  assert.deepEqual([r.filas, r.cambios.length, r.cambios[0].antes, r.cambios[0].despues], [1, 1, "amarillo", "verde"]);
});
await prueba("recalcular: sin cifra del archivo la diferencia queda vacía; una semana sin fila se crea; solo cambian las redes y semanas pedidas", async () => {
  await db.query("insert into mk_cobertura_fuente values ($1,'instagram','metricool','2026-10-01','2026-11-30'), ($1,'facebook','metricool','2026-10-01','2026-11-30')", [ORG]);
  await pieza("instagram", [{ corte: "acumulado", fuente: "metricool", valor: 20 }], { dia: dia(LUN2) }); await pieza("facebook", [{ corte: "acumulado", fuente: "metricool", valor: 5 }], { dia: dia(LUN2) });
  await sembrar(LUN2, "facebook", { color: "gris", nota: "FB intacta" }); await sembrar(LUN1, "instagram", { color: "gris", nota: "otra semana" });
  await rec(LUN2, LUN2, ["instagram"]);
  const nueva_ = await fila(LUN2); assert.equal(nueva_.color_calculado, "amarillo"); assert.equal(nueva_.diferencia, null); assert.equal(nueva_.piezas_calendario, null);
  assert.equal((await fila(LUN2, "facebook")).nota, "FB intacta"); assert.equal((await fila(LUN1)).nota, "otra semana");
});
await prueba("recalcular: guarda ANTES de escribir una foto de las filas que toca (bitácora) y la reversa las restaura exactamente", async () => {
  await db.query("insert into mk_cobertura_fuente values ($1,'instagram','metricool','2026-10-01','2026-11-30')", [ORG]);
  await pieza("instagram", [{ corte: "acumulado", fuente: "metricool", valor: 40 }], { dia: dia(LUN1) });
  await sembrar(LUN1, "instagram", { pc: 7, prom: 3, color: "rojo", gris: null, pcal: 7, pro_cal: 3, nota: "original" });
  const antes = await fila(LUN1); await rec(LUN1, LUN1);
  const b = (await db.query("select * from mk_bitacora where accion='recalculo_semaforo'")).rows; assert.equal(b.length, 1); assert.equal(b[0].agente, "sistema");
  assert.equal(b[0].detalle.antes.length, 1); assert.equal(b[0].detalle.antes[0].nota, "original"); assert.equal(b[0].detalle.antes[0].color_calculado, "rojo");
  assert.notEqual((await fila(LUN1)).color_calculado, "rojo");
  await db.exec(rbRecalcular);
  const despues = await fila(LUN1); for (const k of ["piezas_calculadas", "color_calculado", "motivo_gris", "nota", "piezas_calendario"]) assert.equal(despues[k], antes[k], k);
  assert.equal(Number(despues.promedio_calculado), Number(antes.promedio_calculado));
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname='mk_recalcular_semaforo'")).rows[0].n, 0);
  await db.exec(recalcular); // las pruebas siguientes comparten base: se vuelve a crear
});
await prueba("recalcular: es idempotente (repetirlo deja los mismos valores y no duplica filas)", async () => {
  await db.query("insert into mk_cobertura_fuente values ($1,'instagram','metricool','2026-10-01','2026-11-30')", [ORG]);
  await pieza("instagram", [{ corte: "acumulado", fuente: "metricool", valor: 40 }], { dia: dia(LUN1) });
  await rec(LUN1, LUN2); const a = await fila(LUN1); const r2 = await rec(LUN1, LUN2); const b = await fila(LUN1);
  assert.equal((await db.query("select count(*)::int n from mk_calibracion")).rows[0].n, 2); assert.deepEqual([b.piezas_calculadas, b.color_calculado, Number(b.promedio_calculado)], [a.piezas_calculadas, a.color_calculado, Number(a.promedio_calculado)]);
  assert.equal(r2.cambios.length, 0);
});
await prueba("recalcular: semana sin cobertura de la fuente = gris «sin_datos_fuente»; con cobertura y sin piezas = «sin_piezas_publicadas»", async () => {
  await db.query("insert into mk_cobertura_fuente values ($1,'instagram','metricool','2026-11-01','2026-11-30')", [ORG]);
  await rec(LUN1, LUN2); // la semana del 26 oct cubre hasta el 1 nov: hay cobertura (solapa); la del 2 nov también
  assert.equal((await fila(LUN1)).motivo_gris, "sin_piezas_publicadas");
  await db.exec("truncate mk_cobertura_fuente, mk_calibracion"); await rec(LUN1, LUN1); assert.equal((await fila(LUN1)).motivo_gris, "sin_datos_fuente");
});
await prueba("recalcular: valida antes de escribir (fuente, redes, periodo, tope de 60 semanas) y no deja nada escrito", async () => {
  await sembrar(LUN1, "instagram");
  for (const [args, re] of [[[LUN1, LUN2, ["instagram"], "otra"], /fuente no válida/], [[LUN1, LUN2, [], "metricool"], /redes no válidas/], [[LUN1, LUN2, ["tiktok"], "metricool"], /redes no válidas/],
    [[LUN2, LUN1, ["instagram"], "metricool"], /periodo no válido/], [["2020-01-06", LUN2, ["instagram"], "metricool"], /demasiadas semanas/]])
    await assert.rejects(() => db.query("select public.mk_recalcular_semaforo($1,$2,$3,$4::text[],$5)", [ORG, ...args]), re);
  await assert.rejects(() => db.query("select public.mk_recalcular_semaforo(null,$1,$2,$3::text[],'metricool')", [LUN1, LUN2, ["instagram"]]), /falta la organización/);
  assert.equal((await db.query("select count(*)::int n from mk_bitacora")).rows[0].n, 0); assert.equal((await fila(LUN1)).nota, "nota original");
});
await prueba("recalcular: solo service_role puede ejecutarla; la reversa de la corrección devuelve la definición anterior", async () => {
  assert.match(recalcular, /REVOKE ALL ON FUNCTION public\.mk_recalcular_semaforo\(uuid, date, date, text\[\], text\) FROM PUBLIC, anon, authenticated/);
  assert.match(recalcular, /GRANT EXECUTE ON FUNCTION public\.mk_recalcular_semaforo\(uuid, date, date, text\[\], text\) TO service_role/);
  for (const rol of ["anon", "authenticated", "service_role"]) assert.equal((await db.query(`select has_function_privilege('${rol}','public.mk_recalcular_semaforo(uuid,date,date,text[],text)','execute') p`)).rows[0].p, rol === "service_role", rol);
  await db.exec(rbCorregido); await pieza("instagram", [{ corte: "7d", fuente: "metricool", valor: 10 }, { corte: "acumulado", fuente: "metricool", valor: 50 }]);
  assert.equal((await v("mk_semaforo_semana")).piezas, 2); // la definición anterior volvía a contar doble: la reversa funciona
});
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas del semáforo pasaron"); process.exit(fallos ? 1 : 0);
