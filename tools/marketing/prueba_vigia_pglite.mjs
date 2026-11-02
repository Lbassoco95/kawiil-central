// Prueba del vigía contra un Postgres real en memoria (PGlite). No es dependencia del proyecto:
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   PGLITE_PATH=/tmp/pg/node_modules/@electric-sql/pglite/dist/index.js node tools/marketing/prueba_vigia_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH ? "file://" + process.env.PGLITE_PATH : "@electric-sql/pglite");

const ORG = "a0000000-0000-0000-0000-000000000001";
const sqlVigia = readFileSync(new URL("../../supabase/pendientes/20261102130000_marketing_vigia_colchon.sql", import.meta.url), "utf8");
let fallos = 0; const ok = (n) => console.log("  ok  ", n);

async function nuevaBase() {
  const db = new PGlite();
  // Tablas mínimas con las mismas columnas y restricciones relevantes que producción.
  await db.exec(`
    create role service_role; create role anon; create role authenticated;
    create table organizations (id uuid primary key);
    insert into organizations values ('${ORG}');
    create table mk_caso (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null,
      numero integer generated always as identity not null,
      tipo text not null check (tipo in ('colchon','falla_monitoreo','otro')), regla_codigo text,
      red text check (red in ('instagram','facebook','linkedin')), titulo text not null, descripcion text,
      evidencia jsonb not null default '[]', estado text not null default 'abierto', responsable text not null default 'vigilante',
      detectado_at timestamptz not null default now(), cerrado_at timestamptz, updated_at timestamptz not null default now());
    create table mk_bitacora (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null,
      agente text not null check (agente in ('vigilante','revisor','direccion','sistema','informe_diario')),
      accion text not null, resultado text not null, detalle jsonb, caso_id uuid references mk_caso(id),
      registrado_at timestamptz not null default now());
  `);
  await db.exec(sqlVigia);
  return db;
}
const q = async (db, s, p) => (await db.query(s, p)).rows;
const corrida = (db, cuando, extra = {}) => db.query(
  "insert into mk_bitacora (organization_id, agente, accion, resultado, detalle, registrado_at) values ($1,'vigilante','colchon',$2,$3,$4)",
  [ORG, extra.resultado ?? "instagram 6 rojo; facebook 6 rojo; linkedin 6 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados", JSON.stringify({ simulada: extra.simulada ?? false }), cuando]);
const vigia = async (db, ahora) => (await q(db, "select public.mk_vigia_colchon($1::timestamptz) as r", [ahora]))[0].r;
const N = async (db, s) => Number((await q(db, s))[0].n);
const caso = "select count(*) n from mk_caso where tipo='falla_monitoreo' and regla_codigo='colchon' and red is null and estado<>'cerrado'";
const ESCRITURAS = "select (select count(*) from mk_bitacora)+(select count(*) from mk_caso) n";
const prueba = async (nombre, fn) => { try { await fn(); ok(nombre); } catch (e) { fallos++; console.log("  FALLA", nombre, "\n       ", e.message); } };

const H0730 = "2026-11-02T13:30:00Z"; // 7:30 en Ciudad de México del 2 de noviembre

await prueba("trabajo que no corrió: sin registro → fila en bitácora y UN caso de falla abierto", async () => {
  const db = await nuevaBase();
  const r = await vigia(db, H0730);
  assert.match(r, /SIN CORRIDA: caso #1 abierto/);
  assert.equal(await N(db, caso), 1);
  const b = await q(db, "select agente, accion, resultado from mk_bitacora order by registrado_at, resultado");
  assert.ok(b.some((x) => x.agente === "sistema" && x.accion === "vigia_colchon" && x.resultado === "SIN CORRIDA del colchón del 2026-11-02"));
  assert.ok(b.some((x) => x.resultado.startsWith("caso #1 de falla de monitoreo abierto por el vigía")));
});
await prueba("el caso del vigía lo encuentra el filtro de marketing-colchon (se cerrará solo con la siguiente corrida buena)", async () => {
  const db = await nuevaBase(); await vigia(db, H0730);
  const f = await q(db, "select id, numero from mk_caso where organization_id=$1 and tipo='falla_monitoreo' and regla_codigo='colchon' and estado<>'cerrado' and red is null order by numero limit 1", [ORG]);
  assert.equal(f.length, 1);
});
await prueba("no se duplica: dos pasadas el mismo día siguen siendo UN caso", async () => {
  const db = await nuevaBase(); await vigia(db, H0730);
  const r2 = await vigia(db, "2026-11-02T13:31:00Z");
  assert.match(r2, /ya estaba abierto/); assert.equal(await N(db, caso), 1);
  await vigia(db, "2026-11-03T13:30:00Z"); assert.equal(await N(db, caso), 1); // y al día siguiente también
});
await prueba("corrida real del día, exitosa → el vigía no escribe nada", async () => {
  const db = await nuevaBase(); await corrida(db, "2026-11-02T13:00:05Z");
  const antes = await N(db, ESCRITURAS);
  assert.match(await vigia(db, H0730), /^ok:/);
  assert.equal(await N(db, ESCRITURAS), antes); assert.equal(await N(db, caso), 0);
});
await prueba("corrida real del día que falló la lectura (dejó su propio rastro) → el vigía no duplica el aviso", async () => {
  const db = await nuevaBase(); await corrida(db, "2026-11-02T13:00:05Z", { resultado: "falla de lectura: token rechazado" });
  const antes = await N(db, ESCRITURAS);
  assert.match(await vigia(db, H0730), /^ok:/); assert.equal(await N(db, ESCRITURAS), antes);
});
await prueba("una corrida simulada (fecha fija) NO cuenta como corrida real", async () => {
  const db = await nuevaBase(); await corrida(db, "2026-11-02T13:00:05Z", { simulada: true });
  assert.match(await vigia(db, H0730), /SIN CORRIDA/); assert.equal(await N(db, caso), 1);
});
await prueba("la corrida de ayer no cuenta para hoy", async () => {
  const db = await nuevaBase(); await corrida(db, "2026-11-01T13:00:05Z");
  assert.match(await vigia(db, H0730), /SIN CORRIDA/);
});
await prueba("zona horaria: una corrida a las 19:30 del 1 nov en CDMX (01:30 UTC del 2) es de ayer; a las 7:00 del 2 sí es de hoy", async () => {
  const db = await nuevaBase(); await corrida(db, "2026-11-02T01:30:00Z");
  assert.match(await vigia(db, H0730), /SIN CORRIDA/);
  const db2 = await nuevaBase(); await corrida(db2, "2026-11-02T13:00:00Z");
  assert.match(await vigia(db2, H0730), /^ok:/);
});
await prueba("un caso de falla ya cerrado no se reutiliza: si vuelve a fallar se abre uno nuevo", async () => {
  const db = await nuevaBase(); await vigia(db, H0730);
  await db.exec("update mk_caso set estado='cerrado', cerrado_at=now() where tipo='falla_monitoreo'");
  await vigia(db, "2026-11-03T13:30:00Z");
  assert.equal(await N(db, "select count(*) n from mk_caso where tipo='falla_monitoreo'"), 2); assert.equal(await N(db, caso), 1);
});
await prueba("no toca los casos del colchón ni escribe en otras tablas", async () => {
  const db = await nuevaBase();
  await db.exec(`insert into mk_caso (organization_id, tipo, regla_codigo, red, titulo) values ('${ORG}','colchon','colchon','instagram','x')`);
  await vigia(db, H0730);
  assert.equal(await N(db, "select count(*) n from mk_caso where tipo='colchon' and estado='abierto'"), 1);
});
await prueba("la función no es ejecutable por anon/authenticated (REVOKE) y no envía nada afuera", async () => {
  assert.match(sqlVigia, /REVOKE ALL ON FUNCTION public\.mk_vigia_colchon\(timestamptz\) FROM PUBLIC, anon, authenticated/);
  assert.match(sqlVigia, /SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  assert.ok(!/net\.http|http_post|mail|slack|whatsapp/i.test(sqlVigia.replace(/--.*$/gm, "")));
});

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodas las pruebas del vigía pasaron");
process.exit(fallos ? 1 : 0);
