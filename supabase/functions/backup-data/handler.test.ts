/**
 * Pruebas de backup-data con Deno y datos SINTÉTICOS (sin red, sin Supabase).
 *   deno test supabase/functions/backup-data/handler.test.ts
 */
import { handleBackup, safeEqual, TABLES_TO_BACKUP, type BackupDeps, type BackupLogEntry } from "./handler.ts";

const SECRET = "s".repeat(40) + "-secreto-sintetico-de-cron";
const ORG = "a0000000-0000-0000-0000-000000000001";
const OTRA = "b0000000-0000-0000-0000-000000000002";
const USERS: Record<string, { id: string; org: string; g4: boolean }> = {
  "jwt-g4": { id: "u-g4", org: ORG, g4: true },
  "jwt-g1": { id: "u-g1", org: ORG, g4: false },
  "jwt-g4-otra": { id: "u-g4-otra", org: OTRA, g4: true },
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Tablas sintéticas: una fila por tabla con un marcador reconocible. */
function fakeRows(table: string) {
  return [{ id: `${table}-1`, marca: `dato-sintetico-${table}` }];
}

function deps(over: Partial<BackupDeps> = {}) {
  const reads: string[] = [];
  const uploads: { path: string; json: string }[] = [];
  const logs: BackupLogEntry[] = [];
  const d: BackupDeps = {
    cronSecret: SECRET,
    organizationId: ORG,
    verifyJwt: async (t) => (USERS[t] ? { id: USERS[t].id } : null),
    staffInfo: async (id) => {
      const u = Object.values(USERS).find((x) => x.id === id)!;
      return { organizationId: u.org, isG4: u.g4 };
    },
    readTable: async (t) => { reads.push(t); return { rows: fakeRows(t) }; },
    upload: async (path, json) => { uploads.push({ path, json }); return null; },
    log: async (e) => { logs.push(e); },
    now: () => new Date("2026-09-28T12:00:00Z"),
    ...over,
  };
  return { d, reads, uploads, logs };
}

const post = (headers: Record<string, string> = {}, body: unknown = {}) =>
  new Request("http://local/backup-data", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

Deno.test("A1 · sin credencial, secreto equivocado, JWT no-G4 o de otra organización: rechazo y ninguna lectura", async () => {
  const cases: [Record<string, string>, number, string][] = [
    [{}, 401, "sin_credencial"],
    [{ "x-backup-secret": "equivocado" }, 401, "secreto_invalido"],
    [{ "x-backup-secret": SECRET + "x" }, 401, "secreto_invalido"],
    [{ Authorization: "Bearer jwt-falso" }, 401, "jwt_invalido"],
    [{ Authorization: "Basic abc" }, 401, "sin_credencial"],
    [{ Authorization: "Bearer jwt-g1" }, 403, "no_g4"],
    [{ Authorization: "Bearer jwt-g4-otra" }, 403, "otra_organizacion"],
  ];
  for (const [h, status, reason] of cases) {
    const { d, reads, uploads, logs } = deps();
    const r = await handleBackup(post(h, { include_data: true }), d);
    assert(r.status === status, `${JSON.stringify(h)} → ${r.status}, se esperaba ${status}`);
    const text = await r.text();
    assert(!text.includes("dato-sintetico"), "un rechazo devolvió datos");
    assert(reads.length === 0 && uploads.length === 0, `${reason}: se leyó o subió algo (${reads.length})`);
    assert(logs.length === 1 && logs[0].outcome === "rechazada" && logs[0].reason === reason, `${reason}: bitácora ${JSON.stringify(logs)}`);
  }
});

Deno.test("A1 · cada vía se cierra si falta su variable", async () => {
  for (const [over, h, reason] of [
    [{ cronSecret: undefined }, { "x-backup-secret": SECRET }, "cron_no_configurado"],
    [{ cronSecret: "corto" }, { "x-backup-secret": "corto" }, "cron_no_configurado"],
    [{ organizationId: undefined }, { Authorization: "Bearer jwt-g4" }, "organizacion_no_configurada"],
  ] as [Partial<BackupDeps>, Record<string, string>, string][]) {
    const { d, reads, logs } = deps(over);
    const r = await handleBackup(post(h), d);
    assert(r.status === 401 || r.status === 403, `${reason} → ${r.status}`);
    assert(reads.length === 0 && logs[0].reason === reason, `${reason}: ${JSON.stringify(logs)}`);
  }
});

Deno.test("A1 · métodos distintos de POST se rechazan sin leer", async () => {
  const { d, reads } = deps();
  const r = await handleBackup(new Request("http://local/backup-data", { method: "GET", headers: { "x-backup-secret": SECRET } }), d);
  assert(r.status === 405 && reads.length === 0, `GET → ${r.status}`);
});

Deno.test("A1 · con secreto de cron válido respalda y responde el resumen", async () => {
  const { d, reads, uploads, logs } = deps();
  const r = await handleBackup(post({ "x-backup-secret": SECRET }), d);
  assert(r.status === 200, `cron → ${r.status}`);
  const body = await r.json();
  assert(body.file && body.tables && !("data" in body), "el cron debe recibir solo el resumen");
  assert(reads.length === TABLES_TO_BACKUP.length && uploads.length === 1, "no respaldó todas las tablas");
  assert(logs[0].outcome === "aceptada" && logs[0].via === "cron" && logs[0].user_id === null, JSON.stringify(logs));
});

Deno.test("A1 · G4 de la organización es aceptado", async () => {
  const { d, logs } = deps();
  const r = await handleBackup(post({ Authorization: "Bearer jwt-g4" }), d);
  assert(r.status === 200 && logs[0].via === "g4" && logs[0].user_id === "u-g4", `g4 → ${r.status}`);
});

Deno.test("A1 · la comparación del secreto no sale antes (misma cantidad de trabajo con cualquier entrada)", async () => {
  assert(await safeEqual(SECRET, SECRET), "iguales");
  assert(!(await safeEqual(SECRET, SECRET.slice(0, -1) + "X")), "último carácter distinto");
  assert(!(await safeEqual(SECRET, "")), "vacío");
  assert(!(await safeEqual("a", "b")), "cortos");
  // Se comparan huellas de largo fijo: el largo del secreto recibido no cambia el recorrido.
  const src = await Deno.readTextFile(new URL("./handler.ts", import.meta.url));
  const fn = src.slice(src.indexOf("export async function safeEqual"), src.indexOf("type Auth ="));
  assert(/digest\("SHA-256"/.test(fn) && /diff \|= x\[i\] \^ y\[i\]/.test(fn) && !/return false/.test(fn), "safeEqual debe comparar huellas sin salida temprana");
  assert(!/secret\s*[!=]==?\s*deps\.cronSecret|deps\.cronSecret\s*[!=]==?/.test(src), "no debe haber comparación directa del secreto");
});

Deno.test("A2 · include_data: el cron nunca recibe datos; el G4 sí", async () => {
  const c = deps();
  const rc = await handleBackup(post({ "x-backup-secret": SECRET }, { include_data: true }), c.d);
  const tc = await rc.text();
  assert(rc.status === 200 && !tc.includes("dato-sintetico") && !JSON.parse(tc).data, "el cron recibió datos");
  assert(c.logs[0].include_data === false && c.logs[0].reason === "ok_sin_datos_para_cron", JSON.stringify(c.logs));
  const g = deps();
  const rg = await handleBackup(post({ Authorization: "Bearer jwt-g4" }, { include_data: true }), g.d);
  const bg = await rg.json();
  assert(rg.status === 200 && bg.data && bg.summary, "el G4 no recibió datos");
  assert(g.logs[0].include_data === true, JSON.stringify(g.logs));
  const s = deps();
  const rs = await handleBackup(post({ Authorization: "Bearer jwt-g4" }), s.d);
  assert(!(await rs.text()).includes("dato-sintetico"), "sin include_data no debe haber datos");
});
