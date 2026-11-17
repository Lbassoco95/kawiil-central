import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HERRAMIENTA_AVISO, borradorDeRespuesta, hoyEnMexico, systemRedactor, validarAviso, vigente } from "./avisos.ts";

const HOY = "2026-11-16";
const ok = { tipo: "dia_inhabil", titulo: "Hoy no se trabaja", mensaje: "Hoy lunes 16 de noviembre no se trabaja. Retomamos el martes 17.", desde: "2026-11-16", hasta: "2026-11-16" };

test("hoyEnMexico: usa la fecha de Ciudad de México (no la de UTC)", () => {
  assert.equal(hoyEnMexico(new Date("2026-11-16T05:59:00Z")), "2026-11-15");
  assert.equal(hoyEnMexico(new Date("2026-11-16T06:00:00Z")), "2026-11-16");
});
test("validarAviso: acepta un aviso bien formado y limpia espacios", () => {
  const v = validarAviso({ ...ok, titulo: "  Hoy   no se trabaja ", mensaje: ok.mensaje + "   " }, HOY);
  assert.ok(v.ok); if (v.ok) { assert.equal(v.aviso.titulo, "Hoy no se trabaja"); assert.equal(v.aviso.tipo, "dia_inhabil"); }
});
test("validarAviso: rechaza tipo, textos, fechas y duraciones inválidas", () => {
  const malo = (o: Record<string, unknown>) => { const v = validarAviso({ ...ok, ...o }, HOY); assert.equal(v.ok, false); return v.ok ? [] : v.errores.join(" "); };
  assert.match(malo({ tipo: "otro" }), /tipo/);
  assert.match(malo({ titulo: "ab" }), /título/);
  assert.match(malo({ mensaje: "" }), /mensaje/);
  assert.match(malo({ desde: "16/11/2026" }), /AAAA-MM-DD/);
  assert.match(malo({ desde: "2026-02-31", hasta: "2026-02-31" }), /existir/);
  assert.match(malo({ desde: "2026-11-20", hasta: "2026-11-18" }), /anterior a la inicial/);
  assert.match(malo({ desde: "2026-11-01", hasta: "2026-12-20" }), /máximo 31/);
  assert.match(malo({ desde: "2026-11-10", hasta: "2026-11-12" }), /ya terminó/);
  assert.equal(validarAviso(null, HOY).ok, false); assert.equal(validarAviso([], HOY).ok, false);
});
test("validarAviso: un texto que parece contraseña o clave se rechaza", () => {
  const v = validarAviso({ ...ok, mensaje: "La contraseña es hunter22xyz para entrar" }, HOY);
  assert.equal(v.ok, false);
});
test("vigente: incluye el primer y el último día; solo publicados", () => {
  const a = { desde: "2026-11-16", hasta: "2026-11-18", estado: "publicado" };
  assert.deepEqual(["2026-11-15", "2026-11-16", "2026-11-18", "2026-11-19"].map((d) => vigente(a, d)), [false, true, true, false]);
  assert.equal(vigente({ ...a, estado: "cancelado" }, "2026-11-17"), false);
});
test("borradorDeRespuesta: toma la herramienta propuesta y la revalida; ignora texto suelto y datos inválidos", () => {
  const bien = [{ type: "text", text: "claro" }, { type: "tool_use", name: HERRAMIENTA_AVISO.name, input: ok }];
  const v = borradorDeRespuesta(bien, HOY); assert.ok(v && v.ok);
  const mal = borradorDeRespuesta([{ type: "tool_use", name: HERRAMIENTA_AVISO.name, input: { ...ok, hasta: "2026-11-01" } }], HOY); assert.ok(mal && !mal.ok);
  assert.equal(borradorDeRespuesta([{ type: "text", text: "no" }], HOY), null);
  assert.equal(borradorDeRespuesta(undefined, HOY), null);
  assert.equal(borradorDeRespuesta([{ type: "tool_use", name: "otra", input: ok }], HOY), null);
});
test("el pedido al modelo: una sola herramienta, que solo propone; el sistema da la fecha de hoy y prohíbe confidencialidad", () => {
  assert.equal(HERRAMIENTA_AVISO.name, "proponer_aviso");
  assert.match(systemRedactor(HOY), /Hoy es 2026-11-16/);
  assert.match(systemRedactor(HOY), /Nunca incluyas contraseñas/); assert.match(systemRedactor(HOY), /Tú solo propones/);
});

const f = readFileSync(new URL("../comunicacion-interna/index.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../../config.toml", import.meta.url), "utf8");
test("comunicacion-interna: JWT, solo admin antes de cualquier acción, el modelo solo propone y no hay envíos externos", () => {
  assert.match(config, /\[functions\.comunicacion-interna\]\s*\n\s*verify_jwt = true/);
  assert.ok(f.indexOf("is_admin_or_manager") < f.indexOf('body.action === "redactar"'));
  assert.match(f, /tools: \[HERRAMIENTA_AVISO\], tool_choice/);
  assert.doesNotMatch(f.replace(/\/\*[\s\S]*?\*\//, ""), /slack|whatsapp|sendgrid|resend|smtp|mailto/i);
  assert.doesNotMatch(f, /\.delete\(/);
});
test("comunicacion-interna: publicar revalida el aviso, guarda quién aprobó y solo enciende la fila de aviso_equipo", () => {
  const i = f.indexOf('body.action === "publicar"'), j = f.indexOf('body.action === "cancelar"');
  const bloque = f.slice(i, j);
  assert.match(bloque, /validarAviso\(body\.aviso, hoy\)/); assert.match(bloque, /aprobado_por: userId/);
  assert.equal((f.match(/\.from\("aviso_equipo"\)/g) ?? []).length, 3);
  assert.equal((f.match(/rpc\("mk_registrar_corrida"/g) ?? []).length, 1);
});
