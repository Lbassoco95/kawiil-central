// Prueba de la migración 20261104000000_marketing_registrar_agentes.sql contra Postgres real en memoria (PGlite),
// con la tabla agent_registry reproducida con sus restricciones de producción. Uso: PGLITE_PATH=<ruta a dist/index.js> node tools/marketing/prueba_registrar_agentes_pglite.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.PGLITE_PATH);
const db = new PGlite();
await db.exec(`
CREATE TABLE public.agent_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, display_name text NOT NULL, description text,
  role text NOT NULL, status text NOT NULL DEFAULT 'idle', model text DEFAULT 'claude-sonnet-4-20250514', capabilities jsonb DEFAULT '[]', config jsonb DEFAULT '{}',
  last_heartbeat timestamptz, last_task_at timestamptz, tasks_completed integer DEFAULT 0, tasks_failed integer DEFAULT 0, kind text NOT NULL DEFAULT 'consultable',
  UNIQUE (organization_id, name),
  CONSTRAINT agent_registry_kind_check CHECK (kind = ANY (ARRAY['consultable','system'])),
  CONSTRAINT agent_registry_status_check CHECK (status = ANY (ARRAY['idle','working','resting','error','offline','archived'])));
CREATE TABLE public.agent_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid);
INSERT INTO public.agent_registry (organization_id, name, display_name, role, kind) VALUES ('00000000-0000-0000-0000-000000000001','coyolli','Coyolli','coyolli','consultable');
`);
const sql = readFileSync(new URL("../../supabase/migrations/20261104015632_marketing_registrar_agentes.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../../tools/marketing/rollback_registrar_agentes.sql", import.meta.url), "utf8");
const filas = async () => (await db.query(`select name, kind, status, model, tasks_completed, tasks_failed, last_heartbeat, config from public.agent_registry where kind='system' order by name`)).rows;

await db.exec(sql);
let r = await filas();
assert.deepEqual(r.map((x) => x.name), ["marketing_informe_diario", "marketing_vigia", "marketing_vigilante"]);
assert.ok(r.every((x) => x.kind === "system" && x.status === "idle" && x.model === null && x.last_heartbeat === null && x.tasks_completed === 0 && x.tasks_failed === 0), "kind system, idle, sin modelo, sin latido");
assert.ok(r.every((x) => x.config.solo_lectura === true && x.config.modulo === "marketing" && x.config.objetivo && x.config.horario), "config con objetivo y horario");
await db.exec(sql);                                    // idempotente: segunda vez no duplica ni cambia
assert.equal((await filas()).length, 3);
assert.equal((await db.query(`select count(*)::int n from public.agent_registry`)).rows[0].n, 4, "no toca los demás agentes");
assert.equal((await db.query(`select count(*)::int n from public.agent_registry where kind='consultable'`)).rows[0].n, 1, "list-agents (kind=consultable) sigue viendo solo los consultables");
await db.exec(`UPDATE public.agent_registry SET status='offline' WHERE name='marketing_vigia'`);
await db.exec(sql);                                    // no pisa cambios hechos después
assert.equal((await db.query(`select status from public.agent_registry where name='marketing_vigia'`)).rows[0].status, "offline");
// reversa: borra las 3 y solo esas; no borra una que ya tenga tareas
await db.exec(`INSERT INTO public.agent_tasks (agent_id) SELECT id FROM public.agent_registry WHERE name='marketing_vigilante'`);
await db.exec(rollback);
assert.deepEqual((await filas()).map((x) => x.name), ["marketing_vigilante"], "la reversa respeta al agente que ya tiene tareas");
await db.exec(`DELETE FROM public.agent_tasks`); await db.exec(rollback);
assert.equal((await filas()).length, 0);
assert.equal((await db.query(`select count(*)::int n from public.agent_registry`)).rows[0].n, 1, "queda solo Coyolli");
console.log("Todas las pruebas de registrar agentes pasaron");
