import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarSalida, resumirForma, resumirTexto, NUMEROS_PERMITIDOS } from "./metricoolForma.ts";
import { construirPeticion, ErrorLista } from "./metricoolAllowlist.ts";

// ── Todo lo que puede aparecer en la salida: rutas de campos, nombres de tipo, códigos, fechas, zonas y dos marcas fijas ──
const PERMITIDA = /^(|\$(\.[A-Za-z_][A-Za-z0-9_]{0,39}|\[\])*|[A-Za-z][A-Za-z0-9_-]{0,39}|\d{4}-\d{2}-\d{2}|[A-Za-z_]+\/[A-Za-z_]+|\(otro: no es un código\)|\(otros\))$/;
function cadenas(x: unknown, salida: string[] = []): string[] {
  if (typeof x === "string") salida.push(x);
  else if (Array.isArray(x)) x.forEach((e) => cadenas(e, salida));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { salida.push(k); cadenas(v, salida); }
  return salida;
}
const soloPermitido = (salida: unknown) => { for (const c of cadenas(salida)) assert.match(c, PERMITIDA, `cadena no permitida en la salida: ${JSON.stringify(c)}`); };

// ── Respuestas realistas (forma del swagger) con un centinela de texto en cada campo riesgoso ──
const S = { texto: "SENTINELA texto de la publicación", titulo: "SENTINELA título", hashtag: "#SentinelaHashtag", url: "https://sentinela.example/p/123", img: "https://sentinela.example/img.png", correo: "sentinela.persona@ejemplo.mx", nombre: "Sentinela Persona Pérez", ubic: "SENTINELA Ciudad de México", hora: "13:45:07" };
const SENTINELAS = [S.texto, S.titulo, S.hashtag, S.url, S.img, S.correo, S.nombre, S.ubic, S.hora, "SENTINELA", "sentinela.example", "@ejemplo"];
const ig = (i: number) => ({
  postId: "1790" + i, userId: "17841400", businessId: "b1", type: "REEL", publishedAt: { dateTime: `2026-10-0${1 + (i % 5)}T${S.hora}`, timezone: "America/Mexico_City" },
  url: S.url, content: S.texto, imageUrl: S.img, likes: 10 + i, comments: i, shares: 2 + i, interactions: 20 + i, engagement: 3.5, reach: 100 * (i + 1), saved: i,
  follows: 0, impressionsTotal: 150 * (i + 1), views: 90, clicks: 1, hashtags: [S.hashtag, "#otro"], tags: [S.nombre], latitude: "19.43", longitude: "-99.13",
});
const fb = (i: number) => ({ blogId: 5431581, pageId: "p1", postId: "f" + i, created: { dateTime: `2026-10-1${i}T08:00:00`, timezone: "America/Mexico_City" }, link: S.url, text: S.texto, type: "photo", shares: i, comments: 1, reactions: 7, impressions: 300, impressionsUnique: 200 + i, clicks: 4, engagement: 2.1, picture: S.img, ownerName: S.nombre, ownerUrl: S.url });
const li = (i: number) => ({ blogId: 5431581, companyId: "c1", postId: "l" + i, created: { dateTime: `2026-10-2${i}T09:00:00`, timezone: "America/Mexico_City" }, clicks: 3, comments: 0, likes: 5, shares: 1, impressions: 400 + i, uniqueImpressions: 350, engagement: 1.2, url: S.url, description: S.texto, title: S.titulo, picture: S.img });
const prog = (i: number, st: string) => ({
  id: 99 + i, uuid: "uuid-" + i, text: S.texto, creatorUserMail: S.correo, creatorUserId: 7, draft: false, autoPublish: true, firstCommentText: S.texto, hashtags: [S.hashtag],
  publicationDate: { dateTime: `2026-11-0${2 + i}T${S.hora}`, timezone: "America/Mexico_City" }, media: [S.img], location: { name: S.ubic },
  providers: ["facebook", "instagram", "linkedin"].map((network) => ({ network, status: st, detailedStatus: st === "ERROR" ? "Facebook: " + S.texto : st })),
});
const FIXTURES: Record<string, unknown> = {
  instagram: { data: [0, 1, 2, 3, 4, 5].map(ig), metadata: { page: { number: 1 } } },
  facebook: { data: [0, 1, 2].map(fb) }, linkedin: { data: [0, 1, 2].map(li) }, scheduler: { data: [prog(0, "PENDING"), prog(1, "PUBLISHED"), prog(2, "ERROR")] },
};

for (const [nombre, doc] of Object.entries(FIXTURES)) {
  test(`${nombre}: ningún texto, título, hashtag, enlace, nombre, correo ni hora llega a la salida`, () => {
    const salida = armarSalida({ forma: true, ok: true, estado: 200, motivo: "", texto: JSON.stringify(doc) });
    const dump = JSON.stringify(salida);
    for (const s of SENTINELAS) assert.ok(!dump.includes(s), `se filtró «${s}»`);
    soloPermitido(salida);
    assert.equal("datos" in salida, false);
  });
}
test("instagram: números y estructura correctos", () => {
  const f = resumirForma(FIXTURES.instagram);
  assert.equal(f.elementos_lista, 6);
  assert.deepEqual(f.numeros["$.data[].reach"], { n: 6, ceros: 0, min: 100, mediana: 350, media: 350, max: 600 });
  assert.equal(f.numeros["$.data[].saved"].ceros, 1);
  assert.deepEqual(f.campos.find((c) => c.ruta === "$.data[].content")!.tipos, { string: 6 }); // se sabe que existe y es texto, no qué dice
  assert.deepEqual(f.conteos["$.data[].type"], { REEL: 6 });
  assert.equal(f.fechas["$.data[].publishedAt.dateTime"].desde, "2026-10-01");
  assert.equal(f.fechas["$.data[].publishedAt.dateTime"].n, 6);
});
test("scheduler: vocabulario de estados y conteos por red", () => {
  const f = resumirForma(FIXTURES.scheduler);
  assert.deepEqual(f.conteos["$.data[].providers[].status"], { ERROR: 3, PENDING: 3, PUBLISHED: 3 });
  assert.deepEqual(f.conteos["$.data[].providers[].network"], { facebook: 3, instagram: 3, linkedin: 3 });
  assert.equal(f.conteos["$.data[].providers[].detailedStatus"]["(otro: no es un código)"], 3); // «Facebook: <texto>» no es un código: nunca sale
  assert.equal(f.fechas["$.data[].publicationDate.dateTime"].por_semana["2026-11-02"], 3);
});
test("un valor de UNA sola palabra (nombre de pila, etiqueta) bajo un campo no permitido tampoco sale", () => {
  const f = resumirForma({ data: [{ name: "Juanito", content: "Sentinelatoken", hashtags: ["SentinelaTag"], ownerName: "Pedro", status: "PENDING", type: "REEL", network: "instagram" }] });
  const dump = JSON.stringify(f);
  for (const t of ["Juanito", "Sentinelatoken", "SentinelaTag", "Pedro"]) assert.ok(!dump.includes(t), `se filtró «${t}»`);
  assert.deepEqual(f.conteos["$.data[].status"], { PENDING: 1 });
  assert.deepEqual(Object.keys(f.conteos).sort(), ["$.data[].network", "$.data[].status", "$.data[].type"]);
});
test("los números que no están en la lista (ids, coordenadas, usuario, blogId) no salen", () => {
  const f = resumirForma({ data: [{ userId: 17841400, blogId: 5431581, postId: 123456789, latitude: 19.43, reach: 5 }] });
  assert.deepEqual(Object.keys(f.numeros), ["$.data[].reach"]);
  assert.ok(!JSON.stringify(f).includes("5431581") && !JSON.stringify(f).includes("123456789"));
});
test("un código de enumeración que en realidad es una frase se oculta", () => {
  const f = resumirForma({ data: [{ type: "Hola, esta es mi frase libre con correo a@b.com" }, { type: "REEL" }] });
  assert.deepEqual(f.conteos["$.data[].type"], { "(otro: no es un código)": 1, REEL: 1 });
  assert.ok(!JSON.stringify(f).includes("frase libre") && !JSON.stringify(f).includes("a@b.com"));
});
test("claves con forma de dato (espacios, correo, #, :) y diccionarios grandes no salen", () => {
  const dic: Record<string, number> = {}; for (let i = 0; i < 80; i++) dic["usuario" + i] = i;
  const f = resumirForma({ data: { "Juan Pérez": 1, "a@b.com": 2, "#hashtag": 3, ok_campo: 4, dic } });
  const dump = JSON.stringify(f);
  for (const prohibido of ["Juan", "a@b.com", "#hashtag", "usuario5"]) assert.ok(!dump.includes(prohibido));
  assert.ok(f.claves_omitidas >= 83); soloPermitido(f);
});
test("respuestas que no son JSON: solo líneas, columnas y cabeceras con forma de nombre", () => {
  const csv = "postId,reach,saved\n1,500,3\n2,700,4\nSENTINELA texto libre,1,2\n";
  const f = resumirTexto(csv);
  assert.deepEqual([f.lineas, f.columnas, f.cabeceras], [4, 3, ["postId", "reach", "saved"]]);
  assert.ok(!JSON.stringify(f).includes("SENTINELA") && !JSON.stringify(f).includes("500"));
  assert.equal(resumirTexto("correo@ejemplo.mx,reach\n1,2\n").cabeceras, null); // una cabecera con forma de dato no sale
  const s = armarSalida({ forma: true, ok: true, estado: 200, motivo: "", texto: "<html>SENTINELA texto</html>" });
  assert.equal(s.forma!.tipo, "texto"); assert.ok(!JSON.stringify(s).includes("SENTINELA"));
});
test("errores: en modo forma no se devuelve ningún cuerpo, ni como motivo", () => {
  const s = armarSalida({ forma: true, ok: false, estado: 502, motivo: "HTTP 502", texto: "SENTINELA cuerpo del error con correo a@b.com" });
  assert.deepEqual(s, { ok: false, estado: 502, motivo: "HTTP 502", modo: "forma" });
});
test("el modo normal queda igual que antes (lo usa marketing-colchon)", () => {
  const s = armarSalida({ forma: false, ok: true, estado: 200, motivo: "", texto: JSON.stringify({ data: [1] }) });
  assert.deepEqual(s, { ok: true, estado: 200, motivo: "", datos: { data: [1] } });
  assert.deepEqual(armarSalida({ forma: false, ok: false, estado: 502, motivo: "HTTP 502", texto: "x" }), { ok: false, estado: 502, motivo: "HTTP 502", datos: null });
});
test("documento enorme y muy profundo: no se rompe y marca truncado", () => {
  let hondo: unknown = { reach: 1 }; for (let i = 0; i < 30; i++) hondo = { n: hondo };
  assert.equal(resumirForma(hondo).truncado, true);
  const grande = { data: Array.from({ length: 20000 }, (_, i) => ig(i % 7)) };
  const t0 = Date.now(); const f = resumirForma(grande);
  assert.ok(Date.now() - t0 < 3000); assert.equal(f.elementos_lista, 20000);
});

// ── Prueba aleatoria: ningún texto de usuario puede salir, pase lo que pase ───────────────────────────────────────
function rng(semilla: number) { let s = semilla; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
test("aleatoria: 400 documentos hostiles; toda cadena de salida es estructural y ningún texto de usuario aparece", () => {
  const r = rng(20261102);
  const claves = ["reach", "saved", "shares", "type", "status", "network", "timezone", "dateTime", "publishedAt", "created", "text", "content", "title", "url", "hashtags", "creatorUserMail", "name", "data", "providers", "x", "Juan Pérez", "a@b.com", "#tag", "k:v", "con espacio"];
  const textos: string[] = [];
  const texto = () => { const t = `x y ${["correo.a@b.com", "https://z.example/p", "#hashtag", "Frase libre con espacios", "ñandú 😀", "T13:45:07"][Math.floor(r() * 6)]} ${Math.floor(r() * 1e6)}`; textos.push(t); return t; };
  const gen = (p: number): unknown => {
    const q = r();
    if (p > 5 || q < 0.25) return texto();
    if (q < 0.4) return Math.floor(r() * 1000) - 5;
    if (q < 0.45) return null;
    if (q < 0.5) return r() < 0.5;
    if (q < 0.65) return Array.from({ length: Math.floor(r() * 4) }, () => gen(p + 1));
    const o: Record<string, unknown> = {}; const n = Math.floor(r() * 5);
    for (let i = 0; i < n; i++) o[claves[Math.floor(r() * claves.length)]] = gen(p + 1);
    return o;
  };
  for (let i = 0; i < 400; i++) {
    const doc = gen(0);
    const salida = armarSalida({ forma: true, ok: true, estado: 200, motivo: "", texto: JSON.stringify(doc) });
    soloPermitido(salida);
    const dump = JSON.stringify(salida);
    for (const t of textos) assert.ok(!dump.includes(t), `se filtró un texto aleatorio: ${t}`);
    textos.length = 0;
  }
});

// ── Integración con el conector: falla cerrado y solo pasa por armarSalida ─────────────────────────────────────────
test("una operación «forma:...» en un conector sin este modo se rechaza (no devuelve el cuerpo)", () => {
  assert.throws(() => construirPeticion("forma:scheduler_posts", {}, { userId: "4220058", blogId: "5431581" }), ErrorLista);
});
test("conector con modo forma: una sola petición, la lista cerrada sigue mandando y el cuerpo solo pasa por armarSalida", () => {
  const src = readFileSync(new URL("../../pendientes/marketing-metricool-forma/index.ts", import.meta.url), "utf8");
  assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1);
  assert.ok(src.includes("construirPeticion(operacion,") && src.includes("armarSalida({ forma,"));
  assert.ok(!/\bdatos\b/.test(src.replace(/^\s*\/\/.*$/gm, "")), "el conector no debe manejar el cuerpo parseado fuera de armarSalida");
  assert.ok(!/console\./.test(src), "el cuerpo no debe ir a los registros de la función");
  assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(src.split("fetch(")[1].split(")")[0]));
  assert.ok(!/CRON_SECRET|Authorization/.test(src));
  assert.ok(src.includes('operacion: operacionPedida'), "mk_api_log debe registrar que fue una llamada en modo forma");
});
test("la lista de números permitidos es corta y no incluye identificadores", () => {
  assert.ok(NUMEROS_PERMITIDOS.length <= 20);
  for (const k of NUMEROS_PERMITIDOS) assert.ok(!/id$|user|blog|lat|lon|count$/i.test(k) || k === "impressionsTotal", k);
});
