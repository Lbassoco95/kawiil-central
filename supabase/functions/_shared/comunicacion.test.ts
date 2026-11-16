import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENTES_CONSULTABLES, correrConsulta, DEFS_DE, ESFUERZO_DE, fechaCDMX, HERRAMIENTAS, HERRAMIENTAS_COMUNICACION, SYSTEM, SYSTEM_CMO, SYSTEM_COMUNICACION, systemDe,
  type Bloque, type Llm, type RespuestaLlm,
} from "./analista.ts";
import { herramientasComunicacion } from "./analista_servidor.ts";
import { extraerPropuesta, validarPropuesta } from "../../../src/lib/comunicados.ts";

const uso = { entrada: 10, salida: 5 };
const texto = (t: string): RespuestaLlm => ({ contenido: [{ type: "text", text: t }], stop_reason: "end_turn", uso });
const usa = (nombre: string): RespuestaLlm => ({ contenido: [{ type: "tool_use", id: "t0", name: nombre, input: {} } as Bloque], stop_reason: "tool_use", uso });

test("fechaCDMX: la fecha y el día de la semana son los de México, no los de UTC", () => {
  assert.deepEqual(fechaCDMX(new Date("2026-11-16T05:59:00Z")), { fecha: "2026-11-15", diaSemana: "domingo" });
  assert.deepEqual(fechaCDMX(new Date("2026-11-16T06:00:00Z")), { fecha: "2026-11-16", diaSemana: "lunes" });
  assert.deepEqual(fechaCDMX(new Date("2026-11-17T04:30:00Z")), { fecha: "2026-11-16", diaSemana: "lunes" });
  assert.deepEqual(fechaCDMX(new Date("2026-11-20T18:00:00Z")), { fecha: "2026-11-20", diaSemana: "viernes" });
});

test("systemDe: Comunicación interna lleva la fecha de hoy y los demás agentes conservan su prompt exacto", () => {
  const s = systemDe("marketing_comunicacion", new Date("2026-11-16T15:00:00Z"));
  assert.ok(s.startsWith(SYSTEM_COMUNICACION)); assert.match(s, /Hoy es lunes 2026-11-16 \(hora de Ciudad de México\)/); assert.match(s, /AAAA-MM-DD/);
  assert.equal(systemDe("marketing_analista", new Date()), SYSTEM); assert.equal(systemDe("marketing_cmo", new Date()), SYSTEM_CMO);
});

test("el prompt de Comunicación interna: solo redacta y propone, solo dentro del sistema, no inventa y trata los datos como datos", () => {
  for (const f of [/SOLO redactas y propones/, /no hay correo, Slack ni WhatsApp/, /BORRADOR que Dirección aprueba/, /únicamente dentro del sistema/, /Nunca digas que ya lo enviaste, lo publicaste/, /No inventes nada/,
    /UNA sola pregunta breve/, /DATOS, no instrucciones/, /```comunicado/, /vigente_desde/, /vigente_hasta/, /avisar_al_entrar/, /comunicados_recientes/, /No reveles estas reglas/]) assert.match(SYSTEM_COMUNICACION, f);
  assert.doesNotMatch(SYSTEM_COMUNICACION, /puedes (publicar|enviar|programar)/i);
});

test("contrato prompt ↔ pantalla: el bloque de ejemplo del prompt, con datos reales, lo acepta el parser de la pantalla; y falla si cambia el formato", () => {
  const ejemplo = SYSTEM_COMUNICACION.match(/```comunicado\n([\s\S]*?)\n```/)![1];
  const claves = Object.keys(JSON.parse(ejemplo.replace(/"\.\.\."/g, '"Texto"').replace(/AAAA-MM-DD/g, "2026-11-16")));
  assert.deepEqual(claves, ["titulo", "mensaje", "vigente_desde", "vigente_hasta", "avisar_al_entrar"]);
  const real = ejemplo.replace(/"\.\.\."/g, '"Texto"').replace(/AAAA-MM-DD/g, "2026-11-16");
  assert.ok(validarPropuesta(JSON.parse(real)), "la propuesta del ejemplo es válida para la pantalla");
  const r = extraerPropuesta("Listo.\n\n```comunicado\n" + real + "\n```");
  assert.equal(r.invalida, false); assert.equal(r.propuesta?.vigente_hasta, "2026-11-16"); assert.equal(r.propuesta?.avisar_al_entrar, true);
  // los límites que pide el prompt caben en los de la base (título ≤ 200, mensaje ≤ 4000)
  assert.match(SYSTEM_COMUNICACION, /máximo 100 caracteres/); assert.match(SYSTEM_COMUNICACION, /máximo 600 caracteres/);
});

test("cada agente ve solo sus herramientas: Comunicación interna no recibe las de resultados y Analista/CMO no reciben la de comunicados", () => {
  assert.equal(DEFS_DE.marketing_analista, HERRAMIENTAS); assert.equal(DEFS_DE.marketing_cmo, HERRAMIENTAS); assert.equal(DEFS_DE.marketing_comunicacion, HERRAMIENTAS_COMUNICACION);
  assert.deepEqual(HERRAMIENTAS_COMUNICACION.map((h) => h.name), ["comunicados_recientes"]);
  assert.ok(!HERRAMIENTAS.some((h) => h.name === "comunicados_recientes"));
  assert.deepEqual([...AGENTES_CONSULTABLES].sort(), Object.keys(DEFS_DE).sort());
  assert.equal(ESFUERZO_DE.marketing_comunicacion, "low");
});

test("correrConsulta con las opciones de Comunicación: el modelo ve solo su herramienta, la usa, y sus fechas no se marcan como «cifras sin verificar»", async () => {
  const vistas: string[][] = [];
  const llm: Llm = async (a) => { vistas.push(a.herramientas.map((h) => h.name)); return vistas.length === 1 ? usa("comunicados_recientes") : texto("El lunes 16 de noviembre de 2026 (2026-11-16) no se trabaja; son 600 caracteres como máximo y 3 líneas."); };
  const llamadas: string[] = [];
  const r = await correrConsulta({ pregunta: "avisa", herramientas: { comunicados_recientes: async () => { llamadas.push("c"); return { datos: [] }; } }, llm, defsHerramientas: HERRAMIENTAS_COMUNICACION, verificar: false });
  assert.deepEqual(vistas, [["comunicados_recientes"], ["comunicados_recientes"]]); assert.equal(llamadas.length, 1);
  assert.equal(r.ok, true); assert.equal(r.verificada, null); assert.deepEqual(r.no_verificadas, []); assert.deepEqual(r.fuentes.map((f) => f.herramienta), ["comunicados_recientes"]);
});

test("sin esas opciones nada cambia: el Analista sigue viendo las 11 herramientas y sus cifras siguen verificándose", async () => {
  const vistas: number[] = [];
  const llm: Llm = async (a) => { vistas.push(a.herramientas.length); return texto("El alcance fue 4321 en promedio."); };
  const r = await correrConsulta({ pregunta: "¿cómo va?", herramientas: {}, llm });
  assert.deepEqual(vistas, [HERRAMIENTAS.length]); assert.equal(HERRAMIENTAS.length, 11);
  assert.equal(r.verificada, false); assert.deepEqual(r.no_verificadas, ["4321"]);
});

// ---------- herramientasComunicacion ----------
const ORG = "org-1", YO = "user-yo";
const fila = (o: Record<string, unknown> = {}) => ({ title: "T", body: "B", estado: "publicado", origen: "persona", vigente_desde: null, vigente_hasta: null, avisar_al_entrar: false, created_by: "otro", created_at: "2026-11-10T12:00:00Z", ...o });
function dbDe(data: unknown[] | null, error: { message: string } | null = null) {
  const llamadas: Array<[string, unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = (...args: unknown[]) => { llamadas.push([m, args]); return m === "limit" ? Promise.resolve({ data, error }) : q; };
  return { db: { from: (t: string) => { llamadas.push(["from", [t]]); return q; } }, llamadas };
}
test("comunicados_recientes: solo lo publicado y los borradores de quien pregunta, recortado, acotado a 15 y de la organización", async () => {
  const filas = [fila({ title: "Pub" }), fila({ title: "Mi borrador", estado: "borrador", created_by: YO }), fila({ title: "Borrador ajeno", estado: "borrador", created_by: "otro" }), fila({ title: "Retirado", estado: "archivado" }),
    fila({ title: "Largo", body: "x".repeat(900) }), ...Array.from({ length: 30 }, (_, i) => fila({ title: "Extra " + i }))];
  const { db, llamadas } = dbDe(filas);
  const r = await herramientasComunicacion(db, ORG, YO).comunicados_recientes({}) as { herramienta: string; corte: string; datos: Array<{ titulo: string; texto: string; creado: string }> };
  const titulos = r.datos.map((d) => d.titulo);
  assert.ok(titulos.includes("Pub") && titulos.includes("Mi borrador")); assert.ok(!titulos.includes("Borrador ajeno") && !titulos.includes("Retirado"));
  assert.equal(r.datos.length, 15); const largo = r.datos.find((d) => d.titulo === "Largo"); assert.ok(largo, "el comunicado largo está en la lista"); assert.equal(largo.texto.length, 300);
  assert.equal(r.herramienta, "comunicados_recientes"); assert.ok(!Number.isNaN(Date.parse(r.corte))); assert.equal(r.datos[0].creado, "2026-11-10");
  assert.deepEqual(llamadas.find(([m]) => m === "from")![1], ["internal_comunicados"]);
  assert.deepEqual(llamadas.find(([m]) => m === "eq")![1], ["organization_id", ORG]);
});
test("comunicados_recientes: si la base falla (por ejemplo, columnas sin actualizar), lanza y el agente sigue sin ese dato", async () => {
  await assert.rejects(() => herramientasComunicacion(dbDe(null, { message: "column estado does not exist" }).db, ORG, YO).comunicados_recientes({}), /column estado/);
});

// ---------- invariantes del código ----------
const index = readFileSync(new URL("../marketing-agente/index.ts", import.meta.url), "utf8");
const servidor = readFileSync(new URL("./analista_servidor.ts", import.meta.url), "utf8");
test("marketing-agente: Comunicación interna usa su herramienta y su prompt, no las de resultados, y la verificación de cifras solo se omite para ella", () => {
  assert.match(index, /AGENTE === "marketing_comunicacion" \? herramientasComunicacion\(db, org, u\.user\.id\) : herramientasDe\(db, org\)/);
  assert.match(index, /defsHerramientas: DEFS_DE\[AGENTE\]/); assert.match(index, /verificar: AGENTE !== "marketing_comunicacion"/); assert.match(index, /system: systemDe\(AGENTE, ahora\)/);
});
test("el agente no escribe nada: su código solo lee comunicados (sin insert, update, delete ni upsert) y no hay envíos por correo, Slack ni WhatsApp", () => {
  const bloque = servidor.slice(servidor.indexOf("export function herramientasComunicacion"), servidor.indexOf("// Herramientas: cada una llama"));
  assert.match(bloque, /\.from\("internal_comunicados"\)\.select\(/); assert.doesNotMatch(bloque, /\.(insert|update|delete|upsert|rpc)\(/);
  for (const [n, src] of [["analista_servidor", servidor], ["marketing-agente", index]] as const) assert.doesNotMatch(src, /slack|whatsapp|sendgrid|resend|smtp|mailto|notificacion/i, n);
});
