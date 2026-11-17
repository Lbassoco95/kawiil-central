import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agruparMensajes,
  armarAviso,
  claveGrupo,
  desdeEfectivo,
  normalizarAsunto,
  separarRepetidos,
  type Mensaje,
} from "./emailPush.ts";

const m = (received: string, from: string, subject: string): Mensaje => ({ received, from, subject });
const RW = "Build failed for ample-spontaneity";

test("normalizarAsunto: quita RE:/FW:/RV: encadenados, espacios y mayúsculas", () => {
  assert.equal(normalizarAsunto("  RE: Re:  Fwd: Propuesta   Q4 "), "propuesta q4");
  assert.equal(normalizarAsunto("Propuesta Q4"), "propuesta q4");
  assert.equal(normalizarAsunto(""), "");
});

test("claveGrupo: mismo remitente y asunto (aunque cambie el RE: o las mayúsculas) dan la misma clave; otro asunto, otra", () => {
  assert.equal(claveGrupo({ from: "Railway", subject: RW }), claveGrupo({ from: "railway ", subject: `RE: ${RW.toUpperCase()}` }));
  assert.notEqual(claveGrupo({ from: "Railway", subject: RW }), claveGrupo({ from: "Railway", subject: "Deploy succeeded" }));
  assert.notEqual(claveGrupo({ from: "Railway", subject: RW }), claveGrupo({ from: "GitHub", subject: RW }));
  assert.match(claveGrupo({ from: "a", subject: "b" }), /^[0-9a-f]{8}$/);
});

test("agruparMensajes: junta repetidos con su conteo y deja primero lo más reciente", () => {
  const grupos = agruparMensajes([
    m("2026-11-17T04:10:00.000Z", "Railway", RW),
    m("2026-11-17T04:12:00.000Z", "Ana Pérez", "Propuesta Q4"),
    m("2026-11-17T04:15:00.000Z", "Railway", RW),
  ]);
  assert.equal(grupos.length, 2);
  assert.deepEqual(grupos.map((g) => [g.from, g.count]), [["Railway", 2], ["Ana Pérez", 1]]);
  assert.equal(grupos[0].latest, "2026-11-17T04:15:00.000Z");
});

test("desdeEfectivo: nunca busca más atrás de la última hora, pero respeta una marca más reciente", () => {
  const ahora = Date.parse("2026-11-17T12:00:00.000Z");
  assert.equal(desdeEfectivo("2026-11-17T03:00:00.000Z", ahora), "2026-11-17T11:00:00.000Z");
  assert.equal(desdeEfectivo("2026-11-17T11:40:00.000Z", ahora), "2026-11-17T11:40:00.000Z");
  assert.equal(desdeEfectivo("no es una fecha", ahora), "2026-11-17T11:00:00.000Z");
});

test("separarRepetidos: lo ya avisado hace poco va aparte", () => {
  const grupos = agruparMensajes([m("2026-11-17T04:10:00.000Z", "Railway", RW), m("2026-11-17T04:11:00.000Z", "Ana", "Hola")]);
  const ya = new Set([claveGrupo({ from: "Railway", subject: RW })]);
  const { nuevos, repetidos } = separarRepetidos(grupos, ya);
  assert.deepEqual(nuevos.map((g) => g.from), ["Ana"]);
  assert.deepEqual(repetidos.map((g) => g.from), ["Railway"]);
});

test("armarAviso: un correo, varios del mismo remitente y varios remitentes se leen distinto", () => {
  assert.deepEqual(armarAviso(agruparMensajes([m("2026-11-17T04:10:00.000Z", "Railway", RW)])), {
    title: "Correo nuevo",
    body: `Railway: ${RW}`,
  });
  const tres = agruparMensajes([1, 2, 3].map((i) => m(`2026-11-17T04:1${i}:00.000Z`, "Railway", RW)));
  assert.deepEqual(armarAviso(tres), { title: "3 correos nuevos de Railway", body: RW });
  const mezcla = agruparMensajes([
    m("2026-11-17T04:10:00.000Z", "Railway", RW),
    m("2026-11-17T04:11:00.000Z", "Railway", RW),
    m("2026-11-17T04:12:00.000Z", "Ana Pérez", "Propuesta Q4"),
  ]);
  const a = armarAviso(mezcla);
  assert.equal(a.title, "3 correos nuevos");
  assert.equal(a.body, `Ana Pérez: Propuesta Q4 · Railway: ${RW} (×2)`);
});

test("armarAviso: con muchos remitentes muestra 3 y cuenta el resto; el cuerpo nunca pasa del tope", () => {
  const muchos = agruparMensajes(
    ["A", "B", "C", "D", "E"].map((n, i) => m(`2026-11-17T04:1${i}:00.000Z`, n, `Asunto muy largo ${"x".repeat(80)} ${n}`)),
  );
  const a = armarAviso(muchos);
  assert.equal(a.title, "5 correos nuevos");
  assert.match(a.body, /y 2 más$/);
  assert.ok(a.body.length <= 170);
});

test("push-email-poller: ventana de 1 h, agrupa y no repite avisos dentro del silencio", () => {
  const f = readFileSync(new URL("../push-email-poller/index.ts", import.meta.url), "utf8");
  assert.match(f, /from "\.\.\/_shared\/emailPush\.ts"/);
  assert.match(f, /desdeEfectivo\(/);
  assert.match(f, /agruparMensajes\(/);
  assert.match(f, /separarRepetidos\(/);
  assert.match(f, /armarAviso\(/);
});
