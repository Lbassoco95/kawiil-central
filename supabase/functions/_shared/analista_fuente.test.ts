import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Invariantes del código de la función marketing-agente (leído como texto): el agente es solo lectura y no toca Metricool.
const fuente = readFileSync(new URL("../marketing-agente/index.ts", import.meta.url), "utf8");
const analista = readFileSync(new URL("./analista.ts", import.meta.url), "utf8");
const servidor = readFileSync(new URL("./analista_servidor.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../../config.toml", import.meta.url), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\/.*$/gm, "");
const codigo = sinComentarios(fuente), codigoServidor = sinComentarios(servidor);

test("la función exige sesión (verify_jwt = true en config.toml) y comprueba el permiso de Marketing con la sesión del usuario", () => {
  assert.match(config, /\[functions\.marketing-agente\]\s*\n\s*verify_jwt = true/);
  assert.match(codigo, /rpc\("mk_can_view"\)/); assert.match(codigo, /Authorization: auth/);
  assert.ok(codigo.indexOf('rpc("mk_can_view")') < codigo.indexOf("correrConsulta("), "el permiso se comprueba antes de consultar nada");
});
test("no habla con Metricool ni conoce su token", () => {
  assert.doesNotMatch(codigo + codigoServidor + sinComentarios(analista), /metricool\.com|X-Mc-Auth|METRICOOL_USER_TOKEN|METRICOOL_/i);
});
test("solo escribe en mk_consulta; nunca actualiza ni borra; solo llama a las funciones SQL previstas", () => {
  const inserts = [...codigo.matchAll(/\.from\("([a-z_]+)"\)\s*\.insert\(/g)].map((m) => m[1]); assert.deepEqual([...new Set(inserts)], ["mk_consulta"]);
  assert.doesNotMatch(codigo, /\.update\(|\.delete\(|\.upsert\(/);
  const rpcs = [...new Set([...(codigo + codigoServidor).matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(rpcs, ["mk_analista_datos", "mk_can_view", "mk_org_id", "mk_registrar_corrida", "mk_seguimiento_cambiar", "mk_seguimiento_crear"]);
});
test("el secreto de Claude solo se lee por nombre y no hay llaves escritas en el código", () => {
  assert.match(codigo, /Deno\.env\.get\("ANTHROPIC_API_KEY"\)/);
  assert.doesNotMatch(fuente + analista + servidor, /sk-ant-|sk_live|eyJhbGci/);
});
test("las herramientas de la función son exactamente las del módulo del agente", () => {
  const enFuncion = [...codigoServidor.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const lista = codigoServidor.match(/NOMBRES_HERRAMIENTAS = \[([^\]]+)\]/)![1].match(/"([a-z_]+)"/g)!.map((x) => x.replace(/"/g, "")).sort();
  const enModulo = [...analista.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(lista, enModulo); void enFuncion;
});
test("responde a OPTIONS (CORS) y rechaza otros métodos", () => {
  assert.match(codigo, /req\.method === "OPTIONS"/); assert.match(codigo, /req\.method !== "POST"/);
});

// ── marketing-seguimientos (trabajo diario de las 7:45) ───────────────────────────────────────────────────────────────
const seg = readFileSync(new URL("../marketing-seguimientos/index.ts", import.meta.url), "utf8");
const codigoSeg = sinComentarios(seg);

test("seguimientos: se autentica solo con su secreto (sin JWT) y lo compara antes de hacer nada", () => {
  assert.match(config, /\[functions\.marketing-seguimientos\]\s*\n\s*verify_jwt = false/);
  assert.match(codigoSeg, /Deno\.env\.get\("MARKETING_CONNECTOR_SECRET"\)/); assert.match(codigoSeg, /x-marketing-secret/);
  assert.ok(codigoSeg.indexOf("no autorizado") < codigoSeg.indexOf("mk_seguimiento_reclamar"), "el secreto se comprueba antes de reclamar");
  assert.doesNotMatch(codigoSeg, /cron_secret|CRON_SECRET/i);
});
test("seguimientos: solo lectura de datos; escribe únicamente mk_consulta y llama solo a las funciones previstas", () => {
  assert.doesNotMatch(codigoSeg + codigoServidor, /metricool\.com|X-Mc-Auth|METRICOOL_/i);
  const inserts = [...codigoSeg.matchAll(/\.from\("([a-z_]+)"\)\s*\.insert\(/g)].map((m) => m[1]); assert.deepEqual([...new Set(inserts)], ["mk_consulta"]);
  assert.doesNotMatch(codigoSeg, /\.update\(|\.delete\(|\.upsert\(/);
  const rpcs = [...new Set([...codigoSeg.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(rpcs, ["mk_registrar_corrida", "mk_seguimiento_reclamar"]);
});
test("seguimientos: tope por corrida, tope mensual de tokens y sin avisos fuera del panel", () => {
  assert.match(codigoSeg, /MAX_POR_CORRIDA = 5/); assert.match(codigoSeg, /evaluarLimites\(/);
  assert.doesNotMatch(codigoSeg, /slack|whatsapp|smtp|sendgrid|resend|mailto/i);
  assert.doesNotMatch(seg + servidor, /sk-ant-|sk_live|eyJhbGci/);
});
test("marketing-agente: las acciones de seguimiento van después de comprobar sesión, permiso y organización", () => {
  const i = codigo.indexOf('"crear_seguimiento"');
  assert.ok(i > codigo.indexOf('rpc("mk_can_view")') && i > codigo.indexOf('rpc("mk_org_id")'));
});

test("marketing-agente: el agente con el que se habla es de lista cerrada y se guarda en cada consulta", () => {
  assert.match(codigo, /AGENTES_CONSULTABLES as readonly unknown\[\]\)\.includes\(cuerpo\.agente\)/); assert.match(codigo, /Agente no válido/);
  assert.ok((codigo.match(/agente: AGENTE/g) ?? []).length >= 2, "toda inserción en mk_consulta lleva el agente");
  assert.match(codigo, /system: SYSTEM_DE\[AGENTE\]/);
});

test("llamada al modelo: tope de salida amplio (el razonamiento cuenta dentro), esfuerzo opcional, sin desactivar el razonamiento y tool_choice «none» solo en la llamada final", () => {
  const s = codigoServidor;
  const m = s.match(/MAX_TOKENS_SALIDA = (\d[\d_]*)/); assert.ok(m && Number(m[1].replace(/_/g, "")) >= 4000, "max_tokens debe dejar espacio al razonamiento");
  assert.match(s, /max_tokens: MAX_TOKENS_SALIDA/); assert.doesNotMatch(s, /max_tokens: 1024/);
  assert.match(s, /output_config: \{ effort: esfuerzo \}/);
  assert.doesNotMatch(s, /thinking:\s*\{\s*type:\s*"disabled"|budget_tokens|temperature|top_p|top_k/); // el modelo los rechaza con 400
  assert.match(s, /sinHerramientas \? \{ tool_choice: \{ type: "none" \} \}/); assert.doesNotMatch(s, /type: "(any|tool)"/); // tool_choice forzado también da 400
});
