import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { correrCarga, filaResultado, MAX_FILAS_POR_RED, planificarCarga, REDES_CARGABLES, type AlmacenCarga, type FilaResultado, type PiezaSinFila } from "./resultados_carga.ts";
import type { PiezaArchivo, PubApi, Red } from "./resultados.ts";

const T = (f: string, h: string) => new Date(`${f}T${h}:00-06:00`);
const pub = (red: Red, fecha: string, hora: string, valor: number | null, o: Partial<PubApi> = {}): PubApi => ({
  red, id: `${red}-${fecha}-${hora}`, fecha, hora, minutos: Math.floor(T(fecha, hora).getTime() / 60000), zona: "Europe/Madrid", valor, guardados: null, compartidos: 1, clics: 0, reacciones: 2, comentarios: 0, ...o,
});
const arch = (id: string, codigo: string, red: Red, fecha: string, hora: string, valor: number | null = 10): PiezaArchivo => ({ pieza_red_id: id, codigo, red, publicada_at: T(fecha, hora).toISOString(), valor });
const sf = (id: string, codigo: string, fecha: string, hora: string): PiezaSinFila => ({ pieza_id: id, codigo, red_referencia: "facebook", referencia_at: T(fecha, hora).toISOString() });

test("plan: empareja con el calendario, vincula por día y hora las anteriores sin fila y deja fuera la que no tiene pieza", () => {
  const archivo = [arch("pr1", "H-0908", "instagram", "2026-09-08", "10:00"), arch("pr2", "H-0910", "instagram", "2026-09-10", "10:00")];
  const api = [pub("instagram", "2026-09-08", "10:02", 61), pub("instagram", "2026-09-10", "10:04", 50), pub("instagram", "2026-08-03", "11:04", 40),
    pub("instagram", "2026-08-28", "11:04", 30), pub("instagram", "2026-08-28", "16:08", 20), pub("instagram", "2026-09-15", "19:20", 9)];
  const sinFila = [sf("pz-0803", "H-0803", "2026-08-03", "11:00"), sf("pz-0828a", "H-0828", "2026-08-28", "11:00"), sf("pz-0828b", "H-0828-2", "2026-08-28", "16:00")];
  const p = planificarCarga("instagram", archivo, api, sinFila);
  assert.deepEqual(p.pares.map((x) => x.codigo).sort(), ["H-0908", "H-0910"]);
  assert.deepEqual(p.nuevas.map((x) => [x.codigo, x.pub.hora]).sort(), [["H-0803", "11:04"], ["H-0828", "11:04"], ["H-0828-2", "16:08"]]);
  assert.deepEqual(p.sin_vincular, [{ fecha: "2026-09-15", hora: "19:20", motivo: "sin_pieza_ese_dia" }]);
  assert.deepEqual(p.cobertura, { desde: "2026-08-03", hasta: "2026-09-10" });
});
test("plan: más publicaciones que piezas el mismo día → solo una se vincula (la de hora más cercana) y la otra se reporta, no se inventa pieza", () => {
  const p = planificarCarga("instagram", [], [pub("instagram", "2026-08-05", "11:00", 5), pub("instagram", "2026-08-05", "17:30", 6)], [sf("pz", "H-0805", "2026-08-05", "11:02")]);
  assert.equal(p.nuevas.length, 1); assert.equal(p.nuevas[0].pub.hora, "11:00");
  assert.deepEqual(p.sin_vincular, [{ fecha: "2026-08-05", hora: "17:30", motivo: "mas_publicaciones_que_piezas" }]);
});
test("plan: sin nada que cargar no hay cobertura", () => assert.equal(planificarCarga("facebook", [], [], []).cobertura, null));

test("filaResultado: solo números e identificadores; la medida de LinkedIn son impresiones; ningún texto", () => {
  const f = filaResultado("pr1", pub("facebook", "2026-09-08", "10:00", 18.5), "facebook");
  assert.equal(f.medida, "alcance"); assert.equal(filaResultado("x", pub("linkedin", "2026-09-08", "10:00", 3), "linkedin").medida, "impresiones");
  assert.deepEqual(Object.keys(f.extra).sort(), ["carga", "hora_cdmx", "metricool_id", "zona_origen"]);
  for (const v of Object.values(f)) assert.ok(v === null || typeof v === "number" || typeof v === "string" || typeof v === "object");
  assert.deepEqual(Object.keys(f).sort(), ["clics", "comentarios", "compartidos", "extra", "guardados", "medida", "pieza_red_id", "reacciones", "valor"]);
});

// ── Almacén falso que se comporta como la base (únicas por (pieza, corte, fuente) y (pieza, red)) ──────────────────────
function falso(o: { archivo?: PiezaArchivo[]; sinFila?: PiezaSinFila[] } = {}) {
  const log: string[] = [], resultados = new Map<string, FilaResultado>(), piezasRed = new Map<string, string>(), coberturas = new Map<string, { desde: string; hasta: string }>(), bitacoras: Array<Record<string, unknown>> = [];
  let n = 0;
  const almacen: AlmacenCarga = {
    async reglas() { return {}; },
    async piezasArchivo() { return o.archivo ?? []; },
    async piezasSinFila() { return o.sinFila ?? []; },
    async asegurarPiezaRed(x) { const k = `${x.pieza_id}|${x.red}`; if (piezasRed.has(k)) return { id: piezasRed.get(k)!, creada: false }; const id = `nuevo-${++n}`; piezasRed.set(k, id); log.push("pieza_red"); return { id, creada: true }; },
    async guardarResultado(f) { resultados.set(`${f.pieza_red_id}|acumulado|metricool`, f); log.push("resultado"); },
    async guardarCobertura(x) { coberturas.set(x.red, { desde: x.desde, hasta: x.hasta }); log.push("cobertura"); },
    async bitacora(_r, d) { bitacoras.push(d); log.push("bitacora"); },
  };
  return { almacen, log, resultados, piezasRed, coberturas, bitacoras };
}
const leer = (porRed: Partial<Record<Red, PubApi[]>>, llamadas: string[] = []) => async (red: Red) => {
  llamadas.push(red);
  const lista = porRed[red] ?? [];
  // el extractor de la carga lee la respuesta cruda del conector: se la damos ya en la forma de Facebook/Instagram
  return { ok: true as const, datos: lista.map((p) => ({ postId: p.id, reach: p.valor, impressionsUnique: p.valor, shares: p.compartidos, clicks: p.clics, likes: p.reacciones, reactions: p.reacciones, comments: p.comentarios, saved: p.guardados, publishedAt: { dateTime: `${p.fecha}T${p.hora}:00`, timezone: "America/Mexico_City" } })) };
};
const base = () => ({
  archivo: [arch("pr1", "H-0908", "instagram", "2026-09-08", "10:00"), arch("fb1", "H-0731", "facebook", "2026-07-31", "09:00")],
  api: { instagram: [pub("instagram", "2026-09-08", "10:00", 61), pub("instagram", "2026-08-03", "11:04", 40)], facebook: [pub("facebook", "2026-07-31", "09:00", 37)] } as Partial<Record<Red, PubApi[]>>,
  sinFila: [sf("pz-0803", "H-0803", "2026-08-03", "11:00")],
});

test("carga: por omisión es VISTA PREVIA y no escribe nada, pero cuenta exactamente lo que escribiría", async () => {
  const b = base(), f = falso({ archivo: b.archivo, sinFila: b.sinFila });
  const r = await correrCarga({ desde: "2026-07-30", hasta: "2026-10-30", redes: ["instagram", "facebook"], escribir: false, almacen: f.almacen, leerMetricool: leer(b.api) });
  assert.equal(r.escribio, false); assert.equal(r.vista_previa, true); assert.deepEqual(f.log, []);
  const ig = r.redes.find((x) => x.red === "instagram")!, fb = r.redes.find((x) => x.red === "facebook")!;
  assert.deepEqual([ig.resultados, ig.piezas_red_nuevas, fb.resultados, fb.piezas_red_nuevas], [2, 1, 1, 0]);
});
test("carga: escribir guarda resultados, crea solo la fila de pieza que falta, deja la cobertura y UNA entrada de bitácora con los ids creados", async () => {
  const b = base(), f = falso({ archivo: b.archivo, sinFila: b.sinFila });
  const r = await correrCarga({ desde: "2026-07-30", hasta: "2026-10-30", redes: ["instagram", "facebook"], escribir: true, almacen: f.almacen, leerMetricool: leer(b.api) });
  assert.equal(r.escribio, true); assert.equal(f.resultados.size, 3); assert.equal(f.piezasRed.size, 1);
  assert.equal(f.log.filter((x) => x === "bitacora").length, 1); assert.equal(f.log.at(-1), "bitacora");
  assert.deepEqual(f.coberturas.get("instagram"), { desde: "2026-08-03", hasta: "2026-09-08" }); assert.deepEqual(f.coberturas.get("facebook"), { desde: "2026-07-31", hasta: "2026-07-31" });
  assert.deepEqual(r.piezas_red_creadas, ["nuevo-1"]); assert.deepEqual(f.bitacoras[0].piezas_red_creadas, ["nuevo-1"]);
  assert.ok(f.resultados.get("pr1|acumulado|metricool")); assert.ok(f.resultados.get("nuevo-1|acumulado|metricool"));
});
test("carga: es idempotente (repetirla no duplica resultados ni piezas ni cobertura)", async () => {
  const b = base(), f = falso({ archivo: b.archivo, sinFila: b.sinFila });
  const correr = () => correrCarga({ desde: "2026-07-30", hasta: "2026-10-30", redes: ["instagram", "facebook"], escribir: true, almacen: f.almacen, leerMetricool: leer(b.api) });
  await correr(); const r2 = await correr();
  assert.equal(f.resultados.size, 3); assert.equal(f.piezasRed.size, 1); assert.equal(f.coberturas.size, 2); assert.deepEqual(r2.piezas_red_creadas, []);
});
test("carga: LinkedIn no está aprobada (ni se lee) y una red sin publicaciones no se carga", async () => {
  const b = base(), f = falso({ archivo: b.archivo, sinFila: b.sinFila }), llamadas: string[] = [];
  const r = await correrCarga({ desde: "2026-07-30", hasta: "2026-10-30", redes: ["linkedin", "facebook"], escribir: true, almacen: f.almacen, leerMetricool: leer({ ...b.api, linkedin: [pub("linkedin", "2026-09-01", "09:00", 3)] }, llamadas) });
  assert.ok(!llamadas.includes("linkedin")); assert.equal(r.redes.find((x) => x.red === "linkedin")!.cargada, false); assert.equal(r.redes.find((x) => x.red === "linkedin")!.motivo, "red no aprobada para cargar");
  assert.ok(![...f.resultados.values()].some((x) => x.medida === "impresiones"));
  const vacia = await correrCarga({ desde: "2026-07-30", hasta: "2026-10-30", redes: ["facebook"], escribir: true, almacen: falso().almacen, leerMetricool: leer({}) });
  assert.equal(vacia.redes[0].cargada, false); assert.match(vacia.redes[0].motivo ?? "", /no devolvió/);
  assert.deepEqual([...REDES_CARGABLES], ["instagram", "facebook"]);
});
test("carga: la lista de redes es obligatoria y válida; el periodo también (nunca se carga «todo» por omisión)", async () => {
  const f = falso(), args = { desde: "2026-07-30", hasta: "2026-10-30", escribir: true, almacen: f.almacen, leerMetricool: leer({}) };
  for (const redes of [undefined, [], "instagram", ["tiktok"], [null]]) await assert.rejects(() => correrCarga({ ...args, redes }), /redes inválidas/);
  await assert.rejects(() => correrCarga({ ...args, redes: ["facebook"], desde: "ayer" }), /periodo inválido/); await assert.rejects(() => correrCarga({ ...args, redes: ["facebook"], desde: "2026-11-01", hasta: "2026-10-01" }), /periodo inválido/);
  assert.deepEqual(f.log, []);
});
test("carga: una publicación sin cifra de la medida no guarda una fila vacía y se cuenta aparte", async () => {
  const f = falso({ archivo: [arch("fb1", "H-1", "facebook", "2026-07-31", "09:00"), arch("fb2", "H-2", "facebook", "2026-08-03", "09:00")] });
  const r = await correrCarga({ desde: "2026-07-30", hasta: "2026-10-30", redes: ["facebook"], escribir: true, almacen: f.almacen, leerMetricool: leer({ facebook: [pub("facebook", "2026-07-31", "09:00", 12), pub("facebook", "2026-08-03", "09:00", null, {})] }) });
  assert.equal(f.resultados.size, 1); assert.equal(r.redes[0].sin_valor, 1);
});
test(`carga: por encima del tope de ${MAX_FILAS_POR_RED} filas por red no se escribe nada de esa red`, async () => {
  const dias = Array.from({ length: MAX_FILAS_POR_RED + 1 }, (_, i) => { const d = new Date(Date.UTC(2026, 0, 1 + i)); return d.toISOString().slice(0, 10); });
  const f = falso({ archivo: dias.map((d, i) => arch(`p${i}`, `H-${i}`, "facebook", d, "09:00")) });
  const r = await correrCarga({ desde: "2026-01-01", hasta: "2026-12-31", redes: ["facebook"], escribir: true, almacen: f.almacen, leerMetricool: leer({ facebook: dias.map((d) => pub("facebook", d, "09:00", 5)) }) });
  assert.equal(f.resultados.size, 0); assert.equal(r.redes[0].cargada, false); assert.match(r.redes[0].motivo ?? "", /demasiadas filas/);
});

// ── Invariantes del código de la función ───────────────────────────────────────────────────────────────────────────────
const fuente = readFileSync(new URL("../marketing-resultados-carga/index.ts", import.meta.url), "utf8");
const logica = readFileSync(new URL("./resultados_carga.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../../config.toml", import.meta.url), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\/.*$/gm, "");
const codigo = sinComentarios(fuente);

test("la función se autentica solo con su secreto, antes de tocar nada, sin JWT de usuario", () => {
  assert.match(config, /\[functions\.marketing-resultados-carga\]\s*\n\s*verify_jwt = false/);
  assert.match(codigo, /Deno\.env\.get\("MARKETING_CONNECTOR_SECRET"\)/); assert.match(codigo, /x-marketing-secret/);
  assert.ok(codigo.indexOf("no autorizado") < codigo.indexOf("createClient("), "el secreto se comprueba antes de crear el cliente de la base");
  assert.doesNotMatch(codigo, /cron_secret|CRON_SECRET/i);
});
test("solo escribe en las 4 tablas previstas; nunca actualiza ni borra; sin funciones SQL; escribir exige `escribir === true`", () => {
  const tablas = [...new Set([...codigo.matchAll(/\.from\("([a-z_]+)"\)\s*\.(?:insert|upsert)\(/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tablas, ["mk_bitacora", "mk_cobertura_fuente", "mk_pieza_red", "mk_resultado"]);
  assert.doesNotMatch(codigo, /\.update\(|\.delete\(|\.rpc\(/);
  assert.match(codigo, /const escribir = cuerpo\.escribir === true/);
  assert.doesNotMatch(sinComentarios(logica), /\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(|createClient/); // la lógica no toca la base: todo pasa por el almacén inyectado
});
test("no habla con Metricool directamente (solo por el conector) ni conoce su token; secretos por nombre", () => {
  assert.doesNotMatch(codigo + sinComentarios(logica), /metricool\.com|X-Mc-Auth|METRICOOL_[A-Z]|sk-ant-|eyJhbGci/);
  assert.match(codigo, /\/functions\/v1\/marketing-metricool/);
});
test("ningún campo de texto de la publicación llega a las filas (lista cerrada de columnas)", () => {
  const f = filaResultado("x", { ...pub("instagram", "2026-09-08", "10:00", 5), ...({ caption: "TEXTO SECRETO", url: "https://x", hashtags: ["#a"] } as object) } as PubApi, "instagram");
  assert.doesNotMatch(JSON.stringify(f), /SECRETO|https|#a|caption/);
});
