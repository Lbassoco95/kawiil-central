import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  colorDe, contrastarRed, correrSimulacro, emparejar, extraerPublicaciones, fechaHoraCDMX, instanteDe, leerFecha, semanaDe,
  type AlmacenSimulacro, type PiezaArchivo, type PubApi, type Red, type ReglaColor,
} from "./resultados.ts";

const REGLAS: Record<Red, ReglaColor> = { instagram: { verde_desde: 35, amarillo_desde: 15 }, facebook: { verde_desde: 18, amarillo_desde: 10 }, linkedin: { verde_desde: 17, amarillo_desde: 5 } };

// ── Zonas horarias (hallazgo: Instagram trae las horas en Europe/Madrid) ─────────────────────────────────────────────
test("instanteDe: Madrid en verano (UTC+2) y en invierno (UTC+1) se convierten a Ciudad de México (UTC-6)", () => {
  assert.equal(fechaHoraCDMX(instanteDe("2026-09-10T16:00:00", "Europe/Madrid")!).hora, "08:00"); // CEST: 14:00Z → 08:00
  assert.equal(fechaHoraCDMX(instanteDe("2026-10-30T15:00:00", "Europe/Madrid")!).hora, "08:00"); // CET (cambió el 25 oct): 14:00Z → 08:00 (+1 vs +2)
  assert.equal(fechaHoraCDMX(instanteDe("2026-10-30T14:00:00", "Europe/Madrid")!).hora, "07:00");
});
test("una publicación de Madrid de madrugada cae el día anterior en Ciudad de México", () => {
  const f = fechaHoraCDMX(instanteDe("2026-09-11T02:30:00", "Europe/Madrid")!); // 00:30Z → 18:30 del día 10
  assert.deepEqual(f, { fecha: "2026-09-10", hora: "18:30" });
});
test("instanteDe rechaza texto y zonas inválidas sin lanzar", () => {
  assert.equal(instanteDe("ayer", "Europe/Madrid"), null);
  assert.equal(instanteDe("2026-09-10T16:00:00", "Marte/Olimpo"), null);
});
test("leerFecha: objeto con zona, época en segundos y en milisegundos, ISO con y sin zona, y basura", () => {
  assert.equal(fechaHoraCDMX(leerFecha({ dateTime: "2026-09-10T16:00:00", timezone: "Europe/Madrid" })!.instante).hora, "08:00");
  const ms = Date.UTC(2026, 9, 5, 15, 0, 0); // 09:00 CDMX
  assert.equal(fechaHoraCDMX(leerFecha(ms)!.instante).hora, "09:00");
  assert.equal(fechaHoraCDMX(leerFecha(ms / 1000)!.instante).hora, "09:00");
  assert.equal(fechaHoraCDMX(leerFecha("2026-10-05T15:00:00Z")!.instante).hora, "09:00");
  assert.equal(fechaHoraCDMX(leerFecha("2026-10-05T09:00:00")!.instante).hora, "09:00"); // sin zona: Ciudad de México
  assert.equal(leerFecha(12345), null); assert.equal(leerFecha(null), null); assert.equal(leerFecha({ dateTime: 5 }), null);
});
test("semanaDe: lunes de la semana (como mk_semana_inicio)", () => {
  assert.equal(semanaDe("2026-10-26"), "2026-10-26"); assert.equal(semanaDe("2026-11-01"), "2026-10-26"); assert.equal(semanaDe("2026-11-02"), "2026-11-02");
});

// ── Extracción: solo números, fecha y hora; nada de texto de terceros ────────────────────────────────────────────────
const SECRETO = "TEXTO-PRIVADO-123";
const IG = { data: [{ postId: "1790001", type: "FEED_CAROUSEL_ALBUM", publishedAt: { dateTime: "2026-09-10T16:00:00", timezone: "Europe/Madrid" }, reach: 167, saved: 3, shares: 2, likes: 10, comments: 1, clicks: 4, content: SECRETO, url: "https://x/" + SECRETO, hashtags: ["#" + SECRETO], imageUrl: SECRETO }] };
const FB = [{ postId: "f1", created: Date.UTC(2026, 9, 5, 15, 0, 0), impressionsUnique: 12, impressions: 14, shares: 1, reactions: 5, comments: 0, clicks: 2, text: SECRETO, link: SECRETO, picture: SECRETO }];
const LI = { data: [{ postId: "l1", created: { dateTime: "2026-10-06T09:00:00", timezone: "America/Mexico_City" }, impressions: 8, uniqueImpressions: 7, shares: 0, likes: 2, comments: 0, clicks: 1, description: SECRETO, title: SECRETO, url: SECRETO }] };

test("cada red usa su medida: Instagram reach, Facebook impressionsUnique, LinkedIn impressions", () => {
  assert.equal(extraerPublicaciones("instagram", IG)[0].valor, 167);
  assert.equal(extraerPublicaciones("facebook", FB)[0].valor, 12);
  assert.equal(extraerPublicaciones("linkedin", LI)[0].valor, 8);
});
test("Instagram: guardados solo existe ahí; la hora llega convertida y se anota la zona de origen", () => {
  const [p] = extraerPublicaciones("instagram", IG);
  assert.deepEqual({ fecha: p.fecha, hora: p.hora, zona: p.zona, guardados: p.guardados, compartidos: p.compartidos, clics: p.clics, reacciones: p.reacciones }, { fecha: "2026-09-10", hora: "08:00", zona: "Europe/Madrid", guardados: 3, compartidos: 2, clics: 4, reacciones: 10 });
  assert.equal(extraerPublicaciones("facebook", FB)[0].guardados, null);
});
test("Facebook: lista pelada y fecha en época; LinkedIn y los demás: { data: [] }", () => {
  assert.equal(extraerPublicaciones("facebook", FB).length, 1);
  assert.equal(extraerPublicaciones("facebook", { data: FB }).length, 1);
  assert.equal(extraerPublicaciones("facebook", FB)[0].zona, "época");
});
test("PRIVACIDAD: ningún texto, enlace, hashtag ni imagen llega a la salida", () => {
  for (const [red, datos] of [["instagram", IG], ["facebook", FB], ["linkedin", LI]] as const) {
    assert.ok(!JSON.stringify(extraerPublicaciones(red, datos)).includes(SECRETO), red);
  }
});
test("publicaciones sin fecha válida, respuestas vacías, rotas o de otro tipo no lanzan", () => {
  assert.deepEqual(extraerPublicaciones("instagram", { data: [{ postId: "x" }] }), []);
  assert.deepEqual(extraerPublicaciones("linkedin", []), []); assert.deepEqual(extraerPublicaciones("linkedin", null), []);
  assert.deepEqual(extraerPublicaciones("facebook", "csv,roto"), []); assert.deepEqual(extraerPublicaciones("facebook", { data: "x" }), []);
});
test("métricas que no son número se guardan como null (no como 0)", () => {
  const [p] = extraerPublicaciones("instagram", { data: [{ publishedAt: { dateTime: "2026-09-10T10:00:00", timezone: "America/Mexico_City" }, reach: "alto", saved: null }] });
  assert.equal(p.valor, null); assert.equal(p.guardados, null);
});

// ── Contraste ───────────────────────────────────────────────────────────────────────────────────────────────────────
const arch = (codigo: string, publicada_at: string, valor: number | null, red: Red = "instagram"): PiezaArchivo => ({ pieza_red_id: codigo + red, codigo, red, publicada_at, valor });
const pub = (fecha: string, hora: string, valor: number | null, red: Red = "instagram"): PubApi => ({ red, id: fecha + hora, fecha, hora, minutos: Math.floor(new Date(`${fecha}T${hora}:00-06:00`).getTime() / 60000), zona: "America/Mexico_City", valor, guardados: null, compartidos: null, clics: null, reacciones: null, comentarios: null });

test("colorDe: umbrales de la regla vigente; sin dato o sin regla es gris", () => {
  assert.equal(colorDe(35, REGLAS.instagram), "verde"); assert.equal(colorDe(34.99, REGLAS.instagram), "amarillo");
  assert.equal(colorDe(15, REGLAS.instagram), "amarillo"); assert.equal(colorDe(14.9, REGLAS.instagram), "rojo");
  assert.equal(colorDe(null, REGLAS.instagram), "gris"); assert.equal(colorDe(50, null), "gris");
});
test("emparejar: mismo día y hora más cercana, sin repetir; los que sobran se listan", () => {
  const A = [arch("P1", "2026-10-05T15:00:00Z", 10), arch("P2", "2026-10-05T23:00:00Z", 20), arch("P3", "2026-10-07T15:00:00Z", 30)]; // 09:00, 17:00 y otro día
  const B = [pub("2026-10-05", "17:05", 21), pub("2026-10-05", "09:10", 11), pub("2026-10-09", "09:00", 99)];
  const r = emparejar(A, B);
  assert.deepEqual(r.pares.map((p) => [p.a.codigo, p.b.valor]).sort(), [["P1", 11], ["P2", 21]]);
  assert.deepEqual(r.sobraA.map((a) => a.codigo), ["P3"]); assert.deepEqual(r.sobraB.map((b) => b.fecha), ["2026-10-09"]);
});
test("contrastarRed: promedios, diferencia %, colores y criterio de carga cuando todo coincide", () => {
  const A = [arch("P1", "2026-10-05T15:00:00Z", 40), arch("P2", "2026-10-06T15:00:00Z", 50)];
  const B = [pub("2026-10-05", "09:00", 42), pub("2026-10-06", "09:00", 52)];
  const c = contrastarRed("instagram", A, B, REGLAS.instagram);
  assert.equal(c.emparejadas, 2);
  assert.deepEqual(c.semanas, [{ semana: "2026-10-05", piezas_archivo: 2, piezas_api: 2, emparejadas: 2, promedio_archivo: 45, promedio_api: 47, diferencia_pct: 4.4, color_archivo: "verde", color_api: "verde", colores_iguales: true, piezas_con_diferencia: 0 }]);
  assert.equal(c.criterio_de_carga.listo_para_cargar, true);
});
test("API menor que el archivo es imposible en un acumulado: se marca para revisar y bloquea la carga", () => {
  const c = contrastarRed("instagram", [arch("P1", "2026-10-05T15:00:00Z", 40)], [pub("2026-10-05", "09:00", 30)], REGLAS.instagram);
  assert.deepEqual(c.diferencias, [{ codigo: "P1", fecha: "2026-10-05", valor_archivo: 40, valor_api: 30, motivo: "api_menor_que_archivo" }]);
  assert.equal(c.criterio_de_carga.sin_diferencias_por_revisar, false); assert.equal(c.criterio_de_carga.listo_para_cargar, false);
  assert.equal(c.semanas[0].piezas_con_diferencia, 1);
});
test("diferencia mayor a 25 %: el límite es exacto (25 % pasa, más no)", () => {
  assert.equal(contrastarRed("instagram", [arch("P", "2026-10-05T15:00:00Z", 40)], [pub("2026-10-05", "09:00", 50)], REGLAS.instagram).diferencias.length, 0);
  const c = contrastarRed("instagram", [arch("P", "2026-10-05T15:00:00Z", 40)], [pub("2026-10-05", "09:00", 51)], REGLAS.instagram);
  assert.equal(c.diferencias[0].motivo, "diferencia_mayor_a_25_pct");
});
test("colores distintos entre archivo y API bloquean la carga aunque las piezas coincidan", () => {
  const c = contrastarRed("instagram", [arch("P", "2026-10-05T15:00:00Z", 30)], [pub("2026-10-05", "09:00", 36)], REGLAS.instagram);
  assert.equal(c.semanas[0].color_archivo, "amarillo"); assert.equal(c.semanas[0].color_api, "verde");
  assert.equal(c.criterio_de_carga.colores_iguales, false); assert.equal(c.criterio_de_carga.listo_para_cargar, false);
});
test("piezas sin pareja de cualquier lado bloquean la carga y se listan con código y fecha", () => {
  const c = contrastarRed("instagram", [arch("P1", "2026-10-05T15:00:00Z", 40), arch("P9", "2026-10-06T15:00:00Z", 40)], [pub("2026-10-05", "09:00", 40), pub("2026-10-07", "10:00", 40)], REGLAS.instagram);
  assert.deepEqual(c.sin_pareja_archivo, [{ codigo: "P9", fecha: "2026-10-06" }]); assert.deepEqual(c.sin_pareja_api, [{ fecha: "2026-10-07", hora: "10:00" }]);
  assert.equal(c.criterio_de_carga.todas_emparejadas, false); assert.equal(c.criterio_de_carga.listo_para_cargar, false);
});
test("valores nulos no entran al promedio ni al cálculo de diferencias; sin regla, gris", () => {
  const c = contrastarRed("linkedin", [arch("P1", "2026-10-05T15:00:00Z", null, "linkedin")], [pub("2026-10-05", "09:00", 8, "linkedin")], null);
  assert.equal(c.semanas[0].promedio_archivo, null); assert.equal(c.semanas[0].diferencia_pct, null); assert.equal(c.semanas[0].color_api, "gris"); assert.equal(c.diferencias.length, 0);
});

// ── Orquestación (conector y base simulados) ─────────────────────────────────────────────────────────────────────────
const almacen = (piezas: PiezaArchivo[], reglas: Partial<Record<Red, ReglaColor>> = REGLAS): AlmacenSimulacro => ({ piezasArchivo: async () => piezas, reglas: async () => reglas });
const PIEZAS = [arch("IG1", "2026-10-05T15:00:00Z", 40), arch("FB1", "2026-10-05T15:00:00Z", 12, "facebook"), arch("LI1", "2026-10-06T15:00:00Z", 8, "linkedin")];

test("simulacro: lee las tres redes, contrasta y declara que NO escribe datos", async () => {
  const llamadas: string[] = [];
  const r = await correrSimulacro({
    desde: "2026-07-30", hasta: "2026-10-30", ahora: new Date("2026-11-12T00:00:00Z"), almacen: almacen(PIEZAS),
    leerMetricool: async (red, op, entrada) => { llamadas.push(`${op} ${JSON.stringify(entrada)}`); return { ok: true, datos: red === "instagram" ? { data: [{ postId: "1", publishedAt: { dateTime: "2026-10-05T17:00:00", timezone: "Europe/Madrid" }, reach: 42 }] } : red === "facebook" ? [{ postId: "f", created: Date.UTC(2026, 9, 5, 15, 0, 0), impressionsUnique: 13 }] : { data: [{ postId: "l", created: { dateTime: "2026-10-06T09:00:00", timezone: "America/Mexico_City" }, impressions: 9 }] } }; },
  });
  assert.equal(r.simulacro, true); assert.equal(r.escribe_datos, false);
  assert.deepEqual(r.redes.map((x) => x.red), ["instagram", "facebook", "linkedin"]);
  assert.ok(r.redes.every((x) => x.emparejadas === 1));
  assert.equal(r.lecturas[0].zonas["Europe/Madrid"], 1);
  assert.equal(llamadas.length, 3); // un formato basta si el primero devuelve datos
  assert.deepEqual(r.avisos, []);
});
test("simulacro: si el primer formato de fecha devuelve 0 elementos prueba el siguiente y dice cuál sirvió", async () => {
  const vistos: string[] = [];
  const r = await correrSimulacro({
    desde: "2026-07-30", hasta: "2026-10-30", almacen: almacen(PIEZAS),
    leerMetricool: async (red, _op, entrada) => {
      vistos.push(`${red}:${Object.values(entrada)[0]}`);
      const esFecha8 = /^\d{8}$/.test(String(entrada.start ?? ""));
      if (red === "facebook") return { ok: true, datos: esFecha8 ? [] : [{ postId: "f", created: Date.UTC(2026, 9, 5, 15, 0, 0), impressionsUnique: 12 }] };
      return { ok: true, datos: { data: [] } };
    },
  });
  const fb = r.lecturas.find((l) => l.red === "facebook")!;
  assert.equal(fb.formato_fecha, "ISO con hora"); assert.equal(fb.intentos.length, 2); assert.equal(fb.intentos[0].publicaciones, 0);
});
test("simulacro: una red sin publicaciones (LinkedIn del 3 nov) se avisa y NO se contrasta contra una lista vacía", async () => {
  const r = await correrSimulacro({
    desde: "2026-07-30", hasta: "2026-10-30", almacen: almacen(PIEZAS),
    leerMetricool: async (red) => ({ ok: true, datos: red === "linkedin" ? { data: [] } : red === "facebook" ? [{ postId: "f", created: Date.UTC(2026, 9, 5, 15, 0, 0), impressionsUnique: 12 }] : { data: [{ postId: "i", publishedAt: { dateTime: "2026-10-05T09:00:00", timezone: "America/Mexico_City" }, reach: 40 }] } }),
  });
  assert.ok(!r.redes.some((x) => x.red === "linkedin"));
  assert.equal(r.lecturas.find((l) => l.red === "linkedin")!.ok, false);
  assert.ok(r.avisos.some((a) => a.startsWith("linkedin:") && a.includes("No se compara esta red")));
});
test("simulacro: un error del conector no tumba el reporte; queda en avisos con su motivo", async () => {
  const r = await correrSimulacro({
    desde: "2026-07-30", hasta: "2026-10-30", almacen: almacen(PIEZAS),
    leerMetricool: async (red) => { if (red === "instagram") throw new Error("tiempo agotado"); return { ok: false, motivo: "token rechazado o plan sin acceso" }; },
  });
  assert.equal(r.redes.length, 0); assert.equal(r.avisos.length, 3);
  assert.ok(r.avisos[0].includes("tiempo agotado")); assert.ok(r.avisos[1].includes("token rechazado"));
});
test("simulacro: sin reglas legibles los colores salen en gris y se avisa", async () => {
  const r = await correrSimulacro({
    desde: "2026-07-30", hasta: "2026-10-30", almacen: { piezasArchivo: async () => PIEZAS, reglas: async () => { throw new Error("sin acceso"); } },
    leerMetricool: async () => ({ ok: true, datos: { data: [{ postId: "i", publishedAt: { dateTime: "2026-10-05T09:00:00", timezone: "America/Mexico_City" }, reach: 40 }] } }),
  });
  assert.ok(r.avisos.some((a) => a.includes("reglas del semáforo"))); assert.equal(r.redes[0].semanas[0].color_api, "gris");
});
test("simulacro: periodo inválido se rechaza antes de llamar a nada", async () => {
  let llamadas = 0;
  const base = { almacen: almacen(PIEZAS), leerMetricool: async () => { llamadas++; return { ok: true as const, datos: [] }; } };
  await assert.rejects(() => correrSimulacro({ ...base, desde: "30/07/2026", hasta: "2026-10-30" }), /periodo inválido/);
  await assert.rejects(() => correrSimulacro({ ...base, desde: "2026-10-30", hasta: "2026-07-30" }), /periodo inválido/);
  assert.equal(llamadas, 0);
});
test("simulacro: ignora publicaciones de la API fuera del periodo pedido", async () => {
  const r = await correrSimulacro({
    desde: "2026-10-01", hasta: "2026-10-31", almacen: almacen([arch("IG1", "2026-10-05T15:00:00Z", 40)]),
    leerMetricool: async (red) => ({ ok: true, datos: red === "instagram" ? { data: [{ postId: "a", publishedAt: { dateTime: "2026-10-05T09:00:00", timezone: "America/Mexico_City" }, reach: 40 }, { postId: "b", publishedAt: { dateTime: "2026-09-01T09:00:00", timezone: "America/Mexico_City" }, reach: 5 }] } : { data: [] }, }),
  });
  assert.equal(r.redes[0].piezas_api, 1);
});

// ── La función nunca escribe ───────────────────────────────────────────────────────────────────────────────────────
test("el código del simulacro no contiene ninguna escritura a la base", () => {
  for (const f of ["./resultados.ts", "../marketing-resultados/index.ts"]) {
    let src = "";
    try { src = readFileSync(new URL(f, import.meta.url), "utf8"); } catch { continue; }
    const sinComentarios = src.replace(/\/\/.*$/gm, "");
    assert.ok(!/\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(/.test(sinComentarios), `${f} escribe a la base`);
  }
});
