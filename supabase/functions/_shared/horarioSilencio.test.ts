import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enHorarioDeSilencio, minutosDesdeMedianoche, minutosEnZona } from "./horarioSilencio.ts";

// Ciudad de México es UTC-6 todo el año (sin horario de verano desde 2022).
const cdmx = (hhmm: string) => new Date(`2026-11-17T${String((Number(hhmm.slice(0, 2)) + 6) % 24).padStart(2, "0")}:${hhmm.slice(3)}:00Z`);
const defecto = { enabled: true, start: "22:00:00", end: "07:00:00" };

test("minutosDesdeMedianoche: acepta HH:MM y HH:MM:SS, rechaza lo demás", () => {
  assert.equal(minutosDesdeMedianoche("22:00"), 1320);
  assert.equal(minutosDesdeMedianoche("07:30:00"), 450);
  assert.equal(minutosDesdeMedianoche("24:00"), null);
  assert.equal(minutosDesdeMedianoche("7pm"), null);
  assert.equal(minutosDesdeMedianoche(null), null);
});

test("minutosEnZona: convierte UTC a hora de Ciudad de México", () => {
  assert.equal(minutosEnZona(new Date("2026-11-17T04:30:00Z")), 22 * 60 + 30);
  assert.equal(minutosEnZona(new Date("2026-11-17T06:00:00Z")), 0);
  assert.equal(minutosEnZona(new Date("2026-11-17T18:05:00Z")), 12 * 60 + 5);
});

test("horario por defecto 22:00–07:00: silencia de noche y deja avisar de día", () => {
  assert.equal(enHorarioDeSilencio(cdmx("22:00"), defecto), true, "22:00 en punto ya es silencio");
  assert.equal(enHorarioDeSilencio(cdmx("22:30"), defecto), true);
  assert.equal(enHorarioDeSilencio(cdmx("23:59"), defecto), true);
  assert.equal(enHorarioDeSilencio(cdmx("00:00"), defecto), true, "cruza la medianoche");
  assert.equal(enHorarioDeSilencio(cdmx("03:15"), defecto), true);
  assert.equal(enHorarioDeSilencio(cdmx("06:59"), defecto), true);
  assert.equal(enHorarioDeSilencio(cdmx("07:00"), defecto), false, "a las 07:00 ya se puede avisar");
  assert.equal(enHorarioDeSilencio(cdmx("12:00"), defecto), false);
  assert.equal(enHorarioDeSilencio(cdmx("21:59"), defecto), false);
});

test("quien configura una hora más tarde recibe avisos hasta esa hora", () => {
  const tarde = { enabled: true, start: "23:30", end: "07:00" };
  assert.equal(enHorarioDeSilencio(cdmx("22:30"), tarde), false);
  assert.equal(enHorarioDeSilencio(cdmx("23:29"), tarde), false);
  assert.equal(enHorarioDeSilencio(cdmx("23:30"), tarde), true);
});

test("ventana dentro del mismo día (13:00–15:00)", () => {
  const siesta = { enabled: true, start: "13:00", end: "15:00" };
  assert.equal(enHorarioDeSilencio(cdmx("14:00"), siesta), true);
  assert.equal(enHorarioDeSilencio(cdmx("15:00"), siesta), false);
  assert.equal(enHorarioDeSilencio(cdmx("12:59"), siesta), false);
});

test("apagado, inicio igual a fin u horas inválidas: nunca silencia", () => {
  assert.equal(enHorarioDeSilencio(cdmx("23:00"), { ...defecto, enabled: false }), false);
  assert.equal(enHorarioDeSilencio(cdmx("23:00"), { enabled: true, start: "22:00", end: "22:00" }), false);
  assert.equal(enHorarioDeSilencio(cdmx("23:00"), { enabled: true, start: "xx", end: "07:00" }), false);
});

test("sin datos (null/undefined) usa el horario por defecto, activado", () => {
  assert.equal(enHorarioDeSilencio(cdmx("23:00"), {}), true);
  assert.equal(enHorarioDeSilencio(cdmx("23:00"), { enabled: null, start: null, end: null }), true);
  assert.equal(enHorarioDeSilencio(cdmx("12:00"), {}), false);
});

test("sendWebPushToUsers: respeta el silencio salvo que se pida lo contrario, y falla abierto", () => {
  const f = readFileSync(new URL("./webPush.ts", import.meta.url), "utf8");
  assert.match(f, /from "\.\/horarioSilencio\.ts"/);
  assert.match(f, /bypassQuietHours/);
  assert.match(f, /skipped_quiet_hours/);
  assert.match(f, /push_quiet_enabled, push_quiet_start, push_quiet_end/);
});

test("el aviso de solicitudes por aprobar puede sonar de noche; el de prueba también", () => {
  const rutas = readFileSync(new URL("../push-from-notification/index.ts", import.meta.url), "utf8");
  assert.match(rutas, /rh_request_pending: \{ url: "\/rh\?rh=solicitudes", requireInteraction: true, ignoraSilencio: true \}/);
  assert.match(rutas, /rh_request_decided: \{[^}]*ignoraSilencio: false/);
  assert.match(rutas, /bypassQuietHours: ruta\.ignoraSilencio/);
  const prueba = readFileSync(new URL("../push-test/index.ts", import.meta.url), "utf8");
  assert.match(prueba, /bypassQuietHours: true/);
});
