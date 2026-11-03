// Prueba de la corrección de mk_semaforo_semana contra un Postgres real en memoria (PGlite), comparándola con la función ACTUAL
// de producción (copiada tal cual, renombrada a _viejo). Las tablas son réplicas mínimas (mismas columnas relevantes); mk_semana_inicio
// es una réplica de su comportamiento documentado (semana de lunes a domingo, hora de Ciudad de México).
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   PGLITE_PATH=/tmp/pg/node_modules/@electric-sql/pglite/dist/index.js node tools/marketing/prueba_semaforo_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");
const nueva = readFileSync(new URL("../../supabase/pendientes/20261103000000_marketing_semaforo_corregido.sql", import.meta.url), "utf8");

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
  create function public.mk_semana_inicio(ts timestamptz) returns date language sql immutable as $$ select date_trunc('week', ts at time zone 'America/Mexico_City')::date $$;
  insert into mk_regla values ('${ORG}','semaforo_instagram','{"verde_desde":35,"amarillo_desde":15}'), ('${ORG}','semaforo_facebook','{"verde_desde":18,"amarillo_desde":10}');
`);
await db.exec(VIEJA); await db.exec(nueva);

let n = 0, fallos = 0;
const prueba = async (nombre, fn) => { try { await db.exec("truncate mk_resultado, mk_pieza_red, mk_pieza, mk_cobertura_fuente cascade"); await fn(); console.log("  ok  ", nombre); } catch (e) { fallos++; console.log("  FALLA", nombre, "\n       ", e.message); } };
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
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas del semáforo pasaron"); process.exit(fallos ? 1 : 0);
