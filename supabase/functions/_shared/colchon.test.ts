import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decidirCaso, armarInforme, calcularColchon, calcularFaltantes, clasificarEstado, colorColchon, diasEntre, extraerPublicaciones,
  fechaHoraCDMX, hoyCDMX, PARAMS_INICIALES as P, sumarDias, type Publicacion,
} from "./colchon.ts";

// Forma real de /v2/scheduler/posts (probada en producción el 1 nov 2026): 5 publicaciones × 3 redes, todas PENDING.
const post = (fecha: string, hora: string, status = "PENDING", extra: Record<string, unknown> = {}) => ({
  id: 1, text: "TEXTO PRIVADO", creatorUserMail: "alguien@ejemplo.mx", uuid: "u", draft: false, autoPublish: true,
  publicationDate: { dateTime: `${fecha}T${hora}:00`, timezone: "America/Mexico_City" },
  providers: ["facebook", "instagram", "linkedin"].map((network) => ({ network, status, detailedStatus: status })), ...extra,
});
const REAL = { data: [post("2026-11-02", "12:00"), post("2026-11-03", "13:00"), post("2026-11-04", "11:00"), post("2026-11-05", "20:00"), post("2026-11-07", "11:00")] };

test("control del 1 de noviembre: última pieza el 7 → 6 días, rojo en las tres redes", () => {
  const c = calcularColchon(extraerPublicaciones(REAL), "2026-11-01", P);
  assert.deepEqual(c.map((x) => [x.red, x.dias, x.color, x.ultima]), [
    ["instagram", 6, "rojo", "2026-11-07"], ["facebook", 6, "rojo", "2026-11-07"], ["linkedin", 6, "rojo", "2026-11-07"],
  ]);
});
test("al día siguiente el mismo colchón baja a 5", () => {
  assert.equal(calcularColchon(extraerPublicaciones(REAL), "2026-11-02", P)[0].dias, 5);
});
test("umbrales: 14 verde, 13 y 7 amarillo, 6 rojo", () => {
  assert.deepEqual([14, 20, 13, 7, 6, 0].map((d) => colorColchon(d, P)), ["verde", "verde", "amarillo", "amarillo", "rojo", "rojo"]);
});
test("una red sin piezas da 0 días y rojo", () => {
  const c = calcularColchon(extraerPublicaciones({ data: [] }), "2026-11-01", P);
  assert.ok(c.every((x) => x.dias === 0 && x.color === "rojo" && x.ultima === null));
});
test("solo PENDING sin borrador cuenta; error, borrador y estados raros no", () => {
  assert.equal(clasificarEstado("PENDING", false), "programada");
  assert.equal(clasificarEstado("PENDING", true), "desconocido");
  assert.equal(clasificarEstado("PUBLISHED", false), "publicada");
  assert.equal(clasificarEstado("PUBLISHING_ERROR", false), "con_error");
  assert.equal(clasificarEstado("XYZ", false), "desconocido");
  const pubs = extraerPublicaciones({ data: [post("2026-11-20", "10:00", "ERROR"), post("2026-11-25", "10:00", "PENDING", { draft: true }), post("2026-11-09", "10:00")] });
  const c = calcularColchon(pubs, "2026-11-01", P);
  assert.equal(c[0].ultima, "2026-11-09");
  const inf = armarInforme({ hoy: "2026-11-01", simulada: true, colchon: c, pubs, esperadas: [], p: P, piezasEnVentana: 0 });
  assert.equal(inf.con_error.length, 3);
  assert.equal(inf.desconocidos.length, 3);
});
test("otra zona horaria: no se adivina, queda desconocida", () => {
  const raro = { data: [post("2026-11-30", "10:00", "PENDING", { publicationDate: { dateTime: "2026-11-30T10:00:00", timezone: "Asia/Tokyo" } })] };
  const pubs = extraerPublicaciones(raro);
  assert.ok(pubs.every((x) => x.estado === "desconocido"));
});
test("ventana de 45 días: tope", () => {
  const c = calcularColchon(extraerPublicaciones({ data: [post("2026-12-25", "10:00")] }), "2026-11-01", P);
  assert.deepEqual([c[0].dias, c[0].tope, c[0].color], [45, true, "verde"]);
});
test("guarda solo red, fecha, hora y estado: no queda texto, correo ni identificadores", () => {
  const dump = JSON.stringify(extraerPublicaciones(REAL));
  assert.ok(!/TEXTO PRIVADO|alguien@|uuid|creator/i.test(dump));
  assert.deepEqual(Object.keys(extraerPublicaciones(REAL)[0]).sort(), ["estado", "estado_original", "fecha", "hora", "red"]);
});
test("faltantes: pieza esperada sin programar en esa red (tolerancia 30 min)", () => {
  const pubs: Publicacion[] = extraerPublicaciones(REAL).filter((x) => !(x.red === "linkedin" && x.fecha === "2026-11-04"));
  const esperadas = (["instagram", "facebook", "linkedin"] as const).map((red) => ({ red, fecha: "2026-11-04", hora: "11:20", codigo: "K-30", pilar: "PLD", formato: "carrusel" }));
  const f = calcularFaltantes(esperadas, pubs, 30);
  assert.deepEqual(f.map((x) => x.red), ["linkedin"]);
  assert.equal(calcularFaltantes([{ ...esperadas[0], hora: "12:00" }], pubs, 30).length, 1); // 60 min de diferencia: no cruza
});
test("informe: dice qué necesita Dirección y avisa si el calendario no está cargado", () => {
  const pubs = extraerPublicaciones(REAL);
  const inf = armarInforme({ hoy: "2026-11-01", simulada: true, colchon: calcularColchon(pubs, "2026-11-01", P), pubs, esperadas: [], p: P, piezasEnVentana: 0 });
  assert.ok(inf.necesita_direccion.some((t) => t.includes("Calendario Maestro")));
  assert.equal(inf.necesita_direccion.filter((t) => t.includes("colchón es de 6 días")).length, 3);
});
test("fechas en Ciudad de México", () => {
  assert.equal(hoyCDMX(new Date("2026-11-02T02:21:00Z")), "2026-11-01");
  assert.deepEqual(fechaHoraCDMX("2026-11-04T17:00:00Z"), { fecha: "2026-11-04", hora: "11:00" });
  assert.equal(diasEntre("2026-11-01", "2026-11-07"), 6);
  assert.equal(sumarDias("2026-11-01", 45), "2026-12-16");
});
test("la función no puede escribir en Metricool: sin host, token ni métodos de escritura; un solo fetch, al conector", () => {
  const src = readFileSync(new URL("../../pendientes/marketing-colchon/index.ts", import.meta.url), "utf8");
  assert.ok(!/metricool\.com|METRICOOL_USER_TOKEN|X-Mc-Auth/i.test(src));
  assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1);
  assert.ok(src.includes("/functions/v1/marketing-metricool"));
  assert.ok(!/method:\s*["'](PUT|PATCH|DELETE)["']/.test(src));
  assert.ok(!/CRON_SECRET|Authorization/.test(src));
});
test("abrir caso: no envía numero (identidad) y no calla los errores", () => {
  const src = readFileSync(new URL("../../pendientes/marketing-colchon/index.ts", import.meta.url), "utf8");
  assert.ok(!/\bnumero\s*[,:]\s*(numero|\d)/.test(src.split('.insert({')[1] ?? ""));
  assert.ok(!src.includes("maxn"));
  assert.ok(src.includes("erroresCaso.push") && src.includes("ERROR al"));
});

const col = (dias: number) => ({ red: "instagram" as const, ultima: "2026-11-07", dias, color: colorColchon(dias, P), tope: false, programadas: 5 });
const abierto = (dias: number) => ({ id: "c1", numero: 7, evidencia: { dias, ultima_programada: "2026-11-07" } });

test("un solo caso por red: sin caso y colchón bajo → abrir; con caso → actualizar, nunca abrir otro", () => {
  assert.deepEqual(decidirCaso(col(6), P, undefined), { accion: "abrir" });
  for (const d of [0, 5, 6, 13]) assert.equal(decidirCaso(col(d), P, abierto(6)).accion, "actualizar");
});
test("actualizar marca si cambió algo (para no llenar la bitácora de ruido)", () => {
  assert.equal((decidirCaso(col(6), P, abierto(6)) as { cambio: boolean }).cambio, false);
  assert.equal((decidirCaso(col(5), P, abierto(6)) as { cambio: boolean }).cambio, true);
});
test("el caso se cierra cuando el colchón se recupera (14 o más) y no se abre si ya está sano", () => {
  assert.deepEqual(decidirCaso(col(14), P, abierto(6)), { accion: "cerrar", id: "c1", numero: 7, dias_anterior: 6 });
  assert.equal(decidirCaso(col(20), P, abierto(6)).accion, "cerrar");
  assert.deepEqual(decidirCaso(col(14), P, undefined), { accion: "nada" });
});
test("amarillo (7 a 13) sigue siendo colchón bajo la meta: mantiene el caso abierto", () => {
  assert.equal(decidirCaso(col(10), P, abierto(6)).accion, "actualizar");
  assert.equal(decidirCaso(col(10), P, undefined).accion, "abrir");
});
test("la función aplica la decisión y no cierra ni abre casos a ciegas", () => {
  const src = readFileSync(new URL("../../pendientes/marketing-colchon/index.ts", import.meta.url), "utf8");
  assert.ok(src.includes("decidirCaso(") && src.includes('"cerrado"') && src.includes(".update({"));
  assert.ok(src.includes('.neq("estado", "cerrado")'));
});
