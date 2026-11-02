import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { correrColchon, type Almacen, type CasoNuevo, type LecturaMetricool } from "./colchon_run.ts";
import type { CasoAbierto } from "./colchon.ts";

// ── Base de datos simulada en memoria ─────────────────────────────────────────────────────────
interface Caso extends CasoNuevo { id: string; numero: number; estado: string; cerrado_at?: string }
function crearAlmacen(fallos: Partial<Record<string, string>> = {}, calendario = true) {
  const st = { colchon: [] as Array<Record<string, unknown>>, casos: [] as Caso[], informes: [] as unknown[], bitacora: [] as Array<{ agente: string; accion: string; resultado: string }>, n: 6 };
  const f = (nombre: string) => { if (fallos[nombre]) throw new Error(fallos[nombre]); };
  const almacen: Almacen = {
    async leerRegla() { f("regla"); return null; },
    async insertarColchon(filas) { f("colchon"); st.colchon.push(...filas); },
    async casoAbierto(tipo, red, regla): Promise<CasoAbierto | undefined> {
      f(tipo === "colchon" ? "leer_caso_colchon" : "leer_caso_falla");
      const c = st.casos.find((x) => x.tipo === tipo && x.red === red && x.regla_codigo === regla && x.estado !== "cerrado");
      return c ? { id: c.id, numero: c.numero, evidencia: c.evidencia as CasoAbierto["evidencia"] } : undefined;
    },
    async crearCaso(c) { f(c.tipo === "colchon" ? "crear_caso_colchon" : "crear_caso_falla"); const x: Caso = { ...c, id: `c${++st.n}`, numero: st.n, estado: "abierto" }; st.casos.push(x); return { id: x.id, numero: x.numero }; },
    async actualizarCaso(id, cambios) { f("actualizar_caso"); Object.assign(st.casos.find((x) => x.id === id)!, cambios); },
    async piezasVentana() { f("calendario"); return calendario ? { piezas: [{ id: "p1", codigo: "C-20261110", pilar: "PLD", formato: "Imagen única", programada_at: "2026-11-10T23:30:00Z" }], porRed: [] } : { piezas: [], porRed: [] }; },
    async insertarInforme(_f, contenido) { f("informe"); st.informes.push(contenido); return `i${st.informes.length}`; },
    async bitacora(agente, accion, resultado) { f("bitacora"); st.bitacora.push({ agente, accion, resultado }); },
  };
  return { st, almacen };
}
const post = (fecha: string, hora: string) => ({ draft: false, publicationDate: { dateTime: `${fecha}T${hora}:00`, timezone: "America/Mexico_City" }, providers: ["facebook", "instagram", "linkedin"].map((network) => ({ network, status: "PENDING" })) });
const BIEN: LecturaMetricool = { ok: true, datos: { data: [post("2026-11-02", "12:00"), post("2026-11-07", "11:00")] } };
const MAL: LecturaMetricool = { ok: false, motivo: "token rechazado o plan sin acceso" };
const correr = (almacen: Almacen, lectura: LecturaMetricool | Error, hoy = "2026-11-01") =>
  correrColchon({ hoy, simulada: false, almacen, leerMetricool: async () => { if (lectura instanceof Error) throw lectura; return lectura; } });
const fallas = (st: ReturnType<typeof crearAlmacen>["st"]) => st.casos.filter((c) => c.tipo === "falla_monitoreo");
const abiertas = (st: ReturnType<typeof crearAlmacen>["st"], tipo: string) => st.casos.filter((c) => c.tipo === tipo && c.estado !== "cerrado");

// ── Corrida normal ────────────────────────────────────────────────────────────────────────────
test("corrida buena: colchón rojo, 3 casos, informe y bitácora; sin caso de falla", async () => {
  const { st, almacen } = crearAlmacen();
  const r = await correr(almacen, BIEN);
  assert.equal(r.ok, true); assert.equal(r.estado, 200);
  assert.deepEqual(r.colchon.map((c) => [c.red, c.dias, c.color]), [["instagram", 6, "rojo"], ["facebook", 6, "rojo"], ["linkedin", 6, "rojo"]]);
  assert.equal(abiertas(st, "colchon").length, 3); assert.equal(fallas(st).length, 0);
  assert.equal(r.falla_monitoreo, "ninguna");
  assert.ok(st.bitacora.some((b) => b.accion === "informe") && st.bitacora.some((b) => b.accion === "colchon" && b.resultado.includes("3 casos nuevos")));
});

// ── Lectura fallida ───────────────────────────────────────────────────────────────────────────
test("lectura fallida: deja rastro en la bitácora, abre UN caso de falla y no toca colchón ni casos de colchón", async () => {
  const { st, almacen } = crearAlmacen();
  const r = await correr(almacen, MAL);
  assert.equal(r.ok, false); assert.equal(r.estado, 502); assert.equal(r.lectura_ok, false);
  assert.equal(st.colchon.length, 0); assert.equal(st.informes.length, 0); assert.equal(abiertas(st, "colchon").length, 0);
  assert.ok(st.bitacora.some((b) => b.agente === "vigilante" && b.accion === "colchon" && b.resultado === "falla de lectura: token rechazado o plan sin acceso"));
  assert.equal(fallas(st).length, 1);
  assert.equal(fallas(st)[0].red, null); assert.equal(fallas(st)[0].estado, "abierto");
  assert.equal(r.falla_monitoreo, "abierta");
});
test("lectura fallida varios días seguidos: sigue siendo UN solo caso (no se duplica) y solo avisa si cambia el motivo", async () => {
  const { st, almacen } = crearAlmacen();
  await correr(almacen, MAL, "2026-11-02");
  const r2 = await correr(almacen, MAL, "2026-11-03");
  assert.equal(fallas(st).length, 1); assert.equal(r2.falla_monitoreo, "sin_cambio");
  assert.equal(st.bitacora.filter((b) => b.accion === "caso_falla_monitoreo").length, 1); // solo la apertura
  const r3 = await correr(almacen, { ok: false, motivo: "HTTP 502" }, "2026-11-04");
  assert.equal(fallas(st).length, 1); assert.equal(r3.falla_monitoreo, "actualizada");
  assert.ok(fallas(st)[0].descripcion.includes("HTTP 502"));
  assert.equal(st.bitacora.filter((b) => b.accion === "caso_falla_monitoreo").length, 2);
});
test("el conector que lanza una excepción cuenta como lectura fallida (no rompe la corrida)", async () => {
  const { st, almacen } = crearAlmacen();
  const r = await correr(almacen, new Error("boom"));
  assert.equal(r.ok, false); assert.equal(fallas(st).length, 1);
  assert.ok(st.bitacora.some((b) => b.resultado.includes("sin respuesta del conector: boom")));
});

// ── Error al guardar ──────────────────────────────────────────────────────────────────────────
for (const [paso, que] of [["colchon", "guardar el colchón"], ["informe", "guardar el informe"], ["calendario", "leer el Calendario Maestro"], ["crear_caso_colchon", "abrir el caso de instagram"]] as const) {
  test(`error al guardar (${que}): no se calla; queda en la respuesta, en la bitácora y en el caso de falla`, async () => {
    const { st, almacen } = crearAlmacen({ [paso]: "permiso denegado" });
    const r = await correr(almacen, BIEN);
    assert.equal(r.ok, false); assert.equal(r.estado, 500); assert.equal(r.lectura_ok, true);
    assert.ok(r.fallas.some((x) => x.includes(que) && x.includes("permiso denegado")));
    assert.equal(fallas(st).length, 1); assert.equal(r.falla_monitoreo, "abierta");
    assert.ok(st.bitacora.some((b) => b.accion === "colchon" && b.resultado.includes("errores")));
  });
}
test("sin Calendario legible no se inventa un informe de '0 faltantes'", async () => {
  const { st, almacen } = crearAlmacen({ calendario: "falla" });
  await correr(almacen, BIEN);
  assert.equal(st.informes.length, 0);
});
test("si hasta la bitácora falla, el error igual sale en la respuesta", async () => {
  const { almacen } = crearAlmacen({ bitacora: "disco lleno" });
  const r = await correr(almacen, BIEN);
  assert.equal(r.ok, false); assert.ok(r.fallas.some((x) => x.startsWith("bitácora") && x.includes("disco lleno")));
});
test("si no se puede leer un caso, no se decide a ciegas (no abre duplicados)", async () => {
  const { st, almacen } = crearAlmacen({ leer_caso_colchon: "timeout" });
  const r = await correr(almacen, BIEN);
  assert.equal(abiertas(st, "colchon").length, 0);
  assert.ok(r.fallas.some((x) => x.includes("leer el caso de instagram")));
});

// ── Recuperación ──────────────────────────────────────────────────────────────────────────────
test("recuperación: la corrida buena posterior cierra el caso de falla, una sola vez, y deja rastro", async () => {
  const { st, almacen } = crearAlmacen();
  await correr(almacen, MAL, "2026-11-02");
  assert.equal(abiertas(st, "falla_monitoreo").length, 1);
  const r = await correr(almacen, BIEN, "2026-11-03");
  assert.equal(r.ok, true); assert.equal(r.falla_monitoreo, "cerrada");
  assert.equal(abiertas(st, "falla_monitoreo").length, 0); assert.equal(fallas(st).length, 1);
  assert.ok(fallas(st)[0].cerrado_at);
  assert.ok(st.bitacora.some((b) => b.accion === "caso_falla_monitoreo" && b.resultado.includes("cerrado")));
  const r2 = await correr(almacen, BIEN, "2026-11-04");
  assert.equal(r2.falla_monitoreo, "ninguna"); // ya no hay nada que cerrar
  assert.equal(st.bitacora.filter((b) => b.resultado.includes("cerrado: la corrida")).length, 1);
});
test("recuperación parcial: si la corrida aún tiene errores, el caso de falla NO se cierra", async () => {
  const { st, almacen } = crearAlmacen();
  await correr(almacen, MAL, "2026-11-02");
  const mala = crearAlmacen({ informe: "sigue fallando" }); mala.st.casos = st.casos; mala.st.n = st.n;
  const r = await correr(mala.almacen, BIEN, "2026-11-03");
  assert.equal(r.ok, false); assert.equal(abiertas(mala.st, "falla_monitoreo").length, 1);
});
test("recuperación: tras fallar la lectura, el colchón y los casos del colchón vuelven a funcionar", async () => {
  const { st, almacen } = crearAlmacen();
  await correr(almacen, BIEN, "2026-11-01");
  await correr(almacen, MAL, "2026-11-02");
  assert.equal(abiertas(st, "colchon").length, 3); // los casos del colchón siguen abiertos, sin duplicarse
  await correr(almacen, BIEN, "2026-11-03");
  assert.equal(abiertas(st, "colchon").length, 3); assert.equal(st.casos.filter((c) => c.tipo === "colchon").length, 3);
});

// ── Seguridad: no se puede escribir en Metricool desde aquí ───────────────────────────────────
test("colchon_run.ts no hace peticiones ni conoce Metricool; index.ts hace una sola, al conector", () => {
  const run = readFileSync(new URL("./colchon_run.ts", import.meta.url), "utf8");
  assert.ok(!/\bfetch\(|metricool\.com|X-Mc-Auth|METRICOOL_USER_TOKEN/i.test(run));
  const idx = readFileSync(new URL("../../pendientes/marketing-colchon/index.ts", import.meta.url), "utf8");
  assert.equal((idx.match(/\bfetch\(/g) ?? []).length, 1);
  assert.ok(idx.includes("/functions/v1/marketing-metricool") && !/metricool\.com|METRICOOL_USER_TOKEN|X-Mc-Auth/i.test(idx));
  assert.ok(!/method:\s*["'](PUT|PATCH|DELETE)["']/.test(idx) && !/CRON_SECRET|Authorization/.test(idx));
  assert.ok(!/\bnumero\s*:\s*(numero|\d)/.test(run.split("crearCaso")[1] ?? ""));
});
