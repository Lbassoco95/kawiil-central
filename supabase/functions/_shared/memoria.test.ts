import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLUMNAS_MEMORIA, memoriaPublica, memoriasPublicas, resumirMemorias, validarCambio } from "./memoria.ts";

const A = "11111111-1111-4111-8111-111111111111", M = "22222222-2222-4222-8222-222222222222";
const fila = (o: Record<string, unknown> = {}) => ({ id: M, agent_id: A, memory_type: "fact", category: "regulatorio", importance: 7, enabled: true, access_count: 3, last_accessed_at: "2026-11-10T10:00:00Z", expires_at: null, created_at: "2026-11-01T10:00:00Z", ...o });

test("memoriaPublica: solo campos permitidos; nunca content ni source_description aunque vengan en la fila", () => {
  const m = memoriaPublica(fila({ content: "SECRETO del cliente", source_description: "SECRETO" }))!;
  assert.deepEqual(Object.keys(m).sort(), ["activa", "agent_id", "categoria", "creada", "id", "importancia", "tipo", "ultimo_uso", "usos", "vence"]);
  assert.doesNotMatch(JSON.stringify(m), /SECRETO/);
  assert.deepEqual([m.tipo, m.categoria, m.importancia, m.activa, m.usos], ["fact", "regulatorio", 7, true, 3]);
});
test("la lectura nombra sus columnas y no pide el texto", () => {
  assert.doesNotMatch(COLUMNAS_MEMORIA, /content|source_description|\*/);
  const f = readFileSync(new URL("../agente-memoria/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(f, /select\("\*"\)|select\('\*'\)|\.select\(\)/);
  assert.doesNotMatch(f.replace(/\/\*[\s\S]*?\*\//, ""), /(?<![-\w])content(?![-\w])/);
});
test("memoriaPublica: normaliza tipo, importancia y fechas; descarta filas sin ids válidos", () => {
  assert.equal(memoriaPublica(fila({ memory_type: "rara" }))!.tipo, "otro");
  assert.equal(memoriaPublica(fila({ importance: 99 }))!.importancia, 10);
  assert.equal(memoriaPublica(fila({ importance: "x" }))!.importancia, 0);
  assert.equal(memoriaPublica(fila({ expires_at: "no es fecha" }))!.vence, null);
  assert.equal(memoriaPublica(fila({ category: "x".repeat(200) }))!.categoria!.length, 40);
  assert.equal(memoriaPublica(fila({ id: "no-uuid" })), null);
  assert.deepEqual(memoriasPublicas([fila(), fila({ agent_id: 5 }), null, "x"]).length, 1);
  assert.deepEqual(memoriasPublicas(undefined), []);
});
test("validarCambio: solo enciende o apaga una memoria con id válido", () => {
  assert.deepEqual(validarCambio({ id: M, activa: false }), { ok: true, id: M, activa: false });
  assert.equal(validarCambio({ id: "x", activa: true }).ok, false);
  assert.equal(validarCambio({ id: M }).ok, false);
  assert.equal(validarCambio({ id: M, activa: "no" }).ok, false);
});
test("resumirMemorias: activas, apagadas y vencidas", () => {
  const ms = memoriasPublicas([fila(), fila({ enabled: false }), fila({ expires_at: "2026-01-01T00:00:00Z" }), fila({ expires_at: "2027-01-01T00:00:00Z" })]);
  assert.deepEqual(resumirMemorias(ms, new Date("2026-11-16T00:00:00Z")), { total: 4, activas: 3, apagadas: 1, vencidas: 1 });
});
test("agente-memoria: solo admin, JWT obligatorio, acotado a la organización y la escritura solo toca enabled", () => {
  const f = readFileSync(new URL("../agente-memoria/index.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../../config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.agente-memoria\]\s*\n\s*verify_jwt = true/);
  assert.ok(f.indexOf("is_admin_or_manager") < f.indexOf('body.action === "listar"'), "el permiso se comprueba antes de cualquier acción");
  assert.equal((f.match(/\.eq\("organization_id", ORG_AGENTES\)/g) ?? []).length, 2);
  assert.match(f, /\.update\(\{ enabled: v\.activa, updated_at: [^}]+\}\)/);
  assert.doesNotMatch(f, /\.delete\(|\.insert\(|\.upsert\(/);
});
