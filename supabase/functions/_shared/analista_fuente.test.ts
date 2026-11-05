import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Invariantes del código de la función marketing-agente (leído como texto): el agente es solo lectura y no toca Metricool.
const fuente = readFileSync(new URL("../marketing-agente/index.ts", import.meta.url), "utf8");
const analista = readFileSync(new URL("./analista.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../../config.toml", import.meta.url), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\/.*$/gm, "");
const codigo = sinComentarios(fuente);

test("la función exige sesión (verify_jwt = true en config.toml) y comprueba el permiso de Marketing con la sesión del usuario", () => {
  assert.match(config, /\[functions\.marketing-agente\]\s*\n\s*verify_jwt = true/);
  assert.match(codigo, /rpc\("mk_can_view"\)/); assert.match(codigo, /Authorization: auth/);
  assert.ok(codigo.indexOf('rpc("mk_can_view")') < codigo.indexOf("correrConsulta("), "el permiso se comprueba antes de consultar nada");
});
test("no habla con Metricool ni conoce su token", () => {
  assert.doesNotMatch(codigo + sinComentarios(analista), /metricool\.com|X-Mc-Auth|METRICOOL_USER_TOKEN|METRICOOL_/i);
});
test("solo escribe en mk_consulta; nunca actualiza ni borra; solo llama a las funciones SQL previstas", () => {
  const inserts = [...codigo.matchAll(/\.from\("([a-z_]+)"\)\s*\.insert\(/g)].map((m) => m[1]); assert.deepEqual([...new Set(inserts)], ["mk_consulta"]);
  assert.doesNotMatch(codigo, /\.update\(|\.delete\(|\.upsert\(/);
  const rpcs = [...new Set([...codigo.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(rpcs, ["mk_analista_datos", "mk_can_view", "mk_org_id", "mk_registrar_corrida"]);
});
test("el secreto de Claude solo se lee por nombre y no hay llaves escritas en el código", () => {
  assert.match(codigo, /Deno\.env\.get\("ANTHROPIC_API_KEY"\)/);
  assert.doesNotMatch(fuente + analista, /sk-ant-|sk_live|eyJhbGci/);
});
test("las herramientas de la función son exactamente las del módulo del agente", () => {
  const enFuncion = [...codigo.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const lista = codigo.match(/const nombres = \[([^\]]+)\]/)![1].match(/"([a-z_]+)"/g)!.map((x) => x.replace(/"/g, "")).sort();
  const enModulo = [...analista.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(lista, enModulo); void enFuncion;
});
test("responde a OPTIONS (CORS) y rechaza otros métodos", () => {
  assert.match(codigo, /req\.method === "OPTIONS"/); assert.match(codigo, /req\.method !== "POST"/);
});
