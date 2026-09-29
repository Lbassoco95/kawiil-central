/**
 * B5 · Búsqueda de contenido en claro en la base real, Storage, logs de Postgres y
 * respuestas de PostgREST (prueba 9), y de que tras la baja no queda ni el cifrado.
 *
 * Solo corre con PORTAL_B5_DB (lo hace run_portal_api_tests.sh sobre la base con los
 * datos sintéticos de 10_isolation_test.sql). Sin esa variable se omite.
 *   PORTAL_B5_DB     base de prueba (psql con PGHOST/PGPORT/PGUSER)
 *   PGRST_URL        PostgREST frente a esa base (opcional: respuestas de la API)
 *   PGRST_JWT_SECRET secreto de los JWT de prueba
 *   PG_LOG_CMD       comando que imprime el log del servidor Postgres (opcional)
 * Todo el material es sintético y se genera en la corrida.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { createHmac, createHash } from "node:crypto";
import { registerCsd } from "../../../supabase/functions/_shared/portal/csdRegister.ts";
import { publicCsdView } from "../../../supabase/functions/_shared/portal/csd.ts";
import { makeMaterial } from "./csdFixtures";
import { SECRETS, findPlain, needles } from "./b5Needles";
// @ts-expect-error módulo .mjs sin tipos
import { encrypt } from "../../../tools/portal/csdCrypto.mjs";

const DB = process.env.PORTAL_B5_DB;
const REST = process.env.PGRST_URL;
const JWT_SECRET = process.env.PGRST_JWT_SECRET ?? "secreto-local-de-prueba-de-32-caracteres-min";
const ORG = "a0000000-0000-0000-0000-000000000001";   // de 10_isolation_test.sql
const STAFF = "11111111-0000-0000-0000-000000000001"; // G4 de 10_isolation_test.sql
const CLIENT = "b5b5b5b5-0000-0000-0000-0000000000b5";
const USER = "22222222-0000-0000-0000-0000000000b5";
const RFC = "BCI010101B5A";

const lit = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const sql = (q: string) => execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB!, "-c", q], { encoding: "utf8" }).trim();
const dump = () => execFileSync("pg_dump", ["--no-owner", "--no-privileges", "-d", DB!], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const jwt = (sub: string) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" }), p = b({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
};

describe.skipIf(!DB)("B5 · base, Storage, logs y API sin contenido en claro (prueba 9) · baja sin cifrado residual", () => {
  it("de punta a punta", async () => {
    const m = makeMaterial({ rfc: RFC, password: "contrasena-B5-e2e-sintetica", noCertificado: "30001000000500000055" });
    const list = needles(m);
    sql(`ALTER DATABASE ${DB} SET log_statement = 'all'`);
    const logBefore = process.env.PG_LOG_CMD ? execSync(process.env.PG_LOG_CMD, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).length : 0;

    // Titular sintética de un cliente premier, con el aviso aceptado.
    sql(`SELECT set_config('portal.pre_request_ran', 'on', false);
      INSERT INTO public.clients (id, organization_id, name, rfc) VALUES ('${CLIENT}', '${ORG}', 'Cliente Sintético B5', '${RFC}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${USER}', 'b5@prueba.invalid', '{"kawiil_portal":true}') ON CONFLICT (id) DO NOTHING;
      UPDATE public.portal_accounts SET status = 'activa', tier = 'premier' WHERE user_id = '${USER}';
      INSERT INTO public.portal_memberships (client_id, user_id, role) VALUES ('${CLIENT}', '${USER}', 'administrador') ON CONFLICT DO NOTHING;
      SELECT set_config('request.jwt.claims', '{"sub":"${USER}","role":"authenticated"}', false);
      SELECT public.portal_accept_legal('aviso_privacidad');`);

    // Camino real de la Edge (registerCsd) con la base real.
    const logs: string[] = [];
    const orig = { ...console };
    for (const k of ["log", "info", "warn", "error", "debug"] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
    const outcomes: unknown[] = [];
    try {
      const deps = {
        via: "portal" as const,
        secrets: SECRETS,
        preconditions: async () => JSON.parse(sql(`SELECT public.portal_csd_upload_check('${CLIENT}', '${USER}', 'portal')`)),
        clientRfcs: async () => [RFC],
        encrypt,
        fingerprint: async (b: string) => createHash("sha256").update(Buffer.from(b, "base64")).digest("hex"),
        store: async (row: { certCiphertext: string; keyCiphertext: string; passwordCiphertext: string; serialHex: string; subjectRfc: string; notBefore: string; notAfter: string; fingerprint: string }) => {
          const r = JSON.parse(sql(`SELECT public.portal_csd_store('${CLIENT}', '${USER}', 'portal', ${lit(row.certCiphertext)}, ${lit(row.keyCiphertext)}, ${lit(row.passwordCiphertext)},
            ${lit(row.serialHex)}, ${lit(row.subjectRfc)}, ${lit(row.notBefore)}, ${lit(row.notAfter)}, ${lit(row.fingerprint)})`));
          return { registryId: r.registry_id, duplicate: r.duplicate === true };
        },
        audit: async (action: string, details: Record<string, unknown>) => {
          sql(`SELECT public.portal_audit(${lit(action)}, '${CLIENT}', 'portal_csd_registry', NULL, ${lit(JSON.stringify(details))}::jsonb, '${USER}')`);
        },
      };
      outcomes.push(await registerCsd(deps, { ...m, password: "contrasena-equivocada-B5-e2e" }));
      const ok = await registerCsd(deps, m);
      outcomes.push(ok, ok.ok ? publicCsdView({ registry_id: ok.registryId, cert_serial: ok.meta.serial, cert_not_after: ok.meta.notAfter }) : null);
      expect(ok.ok).toBe(true);
    } finally {
      Object.assign(console, orig);
    }
    expect(findPlain(JSON.stringify({ outcomes, logs }), [...list, "contrasena-equivocada-B5-e2e"])).toEqual([]);

    const cipher = sql(`SELECT c.cert_ciphertext || ' ' || c.key_ciphertext || ' ' || s.password_ciphertext FROM public.client_sat_certificates c
      JOIN public.portal_csd_secrets s ON s.certificate_id = c.id WHERE c.client_id = '${CLIENT}'`).split(" ");
    expect(cipher).toHaveLength(3);

    // 1) Base completa, incluido Storage (storage.objects) y la bitácora: sin claro; el cifrado sí está (control).
    const d1 = dump();
    expect(findPlain(d1, [...list, "contrasena-equivocada-B5-e2e"])).toEqual([]);
    for (const c of cipher) expect(d1.includes(c)).toBe(true);

    // 2) Log del servidor (log_statement = all): sin claro; el INSERT cifrado sí quedó (control).
    if (process.env.PG_LOG_CMD) {
      const log = execSync(process.env.PG_LOG_CMD, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).slice(logBefore);
      expect(log.includes(cipher[0].slice(0, 40))).toBe(true);
      expect(findPlain(log, [...list, "contrasena-equivocada-B5-e2e"])).toEqual([]);
    } else {
      console.warn("B5: sin PG_LOG_CMD no se revisó el log del servidor (no verificable en esta corrida).");
    }

    // 3) Respuestas de la API con roles del navegador: ni claro ni cifrado.
    if (REST) {
      const bodies: string[] = [];
      for (const who of [USER, STAFF]) {
        for (const [method, path, body] of [
          ["GET", "/client_sat_certificates?select=*"], ["GET", `/client_sat_certificates?select=cert_ciphertext,key_ciphertext&client_id=eq.${CLIENT}`],
          ["GET", "/portal_csd_secrets?select=*"], ["GET", "/portal_csd_registry?select=*"], ["GET", "/moffin_client_fiel?select=*"],
          ["POST", "/rpc/portal_csd_status", { _client_id: CLIENT }],
        ] as [string, string, object?][]) {
          const r = await fetch(`${REST}${path}`, { method, headers: { Authorization: `Bearer ${jwt(who)}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
          bodies.push(`${who} ${path} ${r.status} ${await r.text()}`);
        }
      }
      const all = bodies.join("\n");
      expect(findPlain(all, list)).toEqual([]);
      for (const c of cipher) expect(all.includes(c), "la API devolvió una columna cifrada").toBe(false);
    }

    // 4) Baja del cliente (B4): después no existe ni el cifrado.
    const res = JSON.parse(sql(`SELECT public.portal_client_offboarding_execute('${CLIENT}', '${STAFF}', 'DAR DE BAJA', '${RFC}')`));
    expect(res.rechazada).toBe(false);
    sql(`DELETE FROM auth.users WHERE id = '${USER}'`);
    sql(`SELECT public.portal_client_offboarding_finish('${res.request_id}')`);
    const d2 = dump();
    expect(findPlain(d2, list)).toEqual([]);
    for (const c of cipher) expect(d2.includes(c), "tras la baja sigue el cifrado del CSD").toBe(false);
    const ver = JSON.parse(sql(`SELECT public.portal_offboarding_record_verification('${res.request_id}', '${USER}', 'b5@prueba.invalid')`));
    expect(ver.ok).toBe(true);
    sql(`ALTER DATABASE ${DB} RESET log_statement`);
  }, 120_000);
});
