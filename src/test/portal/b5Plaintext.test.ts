/**
 * B5 · Nada sensible queda en claro. Con un CSD SINTÉTICO (certificado, llave y
 * contraseña generados en la corrida), se registra por el camino real de la Edge
 * (registerCsd) y se busca el contenido en claro en todo lo que sale de ella:
 * filas que se guardarían, bitácora, consola (logs), mensajes de error y respuestas.
 * Incluye los intentos rechazados (contraseña equivocada, llave de otro certificado,
 * e.firma, sin autorización).
 * La búsqueda en la base, Storage y respuestas de PostgREST reales está en
 * b5Plaintext.db.test.ts (la corre el CI con Postgres y PostgREST).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { registerCsd, type CsdRegisterDeps, type CsdStoreRow } from "../../../supabase/functions/_shared/portal/csdRegister.ts";
import { publicCsdView } from "../../../supabase/functions/_shared/portal/csd.ts";
import { makeMaterial } from "./csdFixtures";
import { SECRETS, findPlain, needles } from "./b5Needles";
// @ts-expect-error módulo .mjs sin tipos
import { encrypt, decrypt } from "../../../tools/portal/csdCrypto.mjs";

describe("B5 · la Edge no deja el CSD en claro en ningún lugar", () => {
  const logs: string[] = [];
  beforeEach(() => {
    for (const k of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); });
    }
  });
  afterEach(() => { vi.restoreAllMocks(); logs.length = 0; });

  function deps(over: Partial<CsdRegisterDeps> = {}) {
    const stored: CsdStoreRow[] = [];
    const audits: unknown[] = [];
    const d: CsdRegisterDeps = {
      via: "portal",
      secrets: SECRETS,
      preconditions: async () => ({ ok: true, missing: [] }),
      clientRfcs: async () => ["AAA010101AAA"],
      encrypt,
      fingerprint: async (b) => `huella-${b.length}`,
      store: async (row) => { stored.push(row); return { registryId: "r-1" }; },
      audit: async (action, details) => { audits.push({ action, details }); },
      ...over,
    };
    return { d, stored, audits };
  }

  it("alta aceptada: solo sale cifrado; lo guardado abre con su secreto y con ningún otro", async () => {
    const m = makeMaterial({ rfc: "AAA010101AAA", password: "contrasena-B5-sintetica" });
    const { d, stored, audits } = deps();
    const r = await registerCsd(d, m);
    expect(r.ok).toBe(true);
    const out = JSON.stringify({ stored, audits, r, view: r.ok ? publicCsdView({ registry_id: r.registryId, cert_serial: r.meta.serial }) : null, logs });
    expect(findPlain(out, needles(m))).toEqual([]);
    // Prueba de que la búsqueda es real: el cifrado sí contiene el material.
    expect(await decrypt(stored[0].certCiphertext, SECRETS.key)).toBe(m.cerB64);
    expect(await decrypt(stored[0].keyCiphertext, SECRETS.key)).toBe(m.keyB64);
    expect(await decrypt(stored[0].passwordCiphertext, SECRETS.password)).toBe(m.password);
    await expect(decrypt(stored[0].keyCiphertext, SECRETS.password)).rejects.toBeTruthy();
    await expect(decrypt(stored[0].passwordCiphertext, SECRETS.key)).rejects.toBeTruthy();
  });

  it("control: si algo filtrara la contraseña o la llave, la búsqueda lo detectaría", async () => {
    const m = makeMaterial({ rfc: "AAA010101AAA", password: "contrasena-B5-sintetica" });
    const { d, audits } = deps({ fingerprint: async () => "x", audit: async (a, det) => { audits.push({ a, det, fuga: m.password }); console.error("fuga", m.keyB64.slice(100, 400)); } });
    await registerCsd(d, m);
    expect(findPlain(JSON.stringify({ audits, logs }), needles(m)).length).toBeGreaterThanOrEqual(2);
  });

  it("intentos rechazados: ni la bitácora, ni el error, ni la consola llevan el material", async () => {
    const m = makeMaterial({ rfc: "AAA010101AAA", password: "contrasena-B5-sintetica" });
    const otra = makeMaterial({ rfc: "AAA010101AAA", password: "otra-B5" });
    const efirma = makeMaterial({ rfc: "AAA010101AAA", kind: "efirma", password: "efirma-B5" });
    const cases = [
      { input: { ...m, password: "contrasena-equivocada-B5" }, over: {} },
      { input: { ...m, keyB64: otra.keyB64, password: otra.password }, over: {} },
      { input: efirma, over: {} },
      { input: m, over: { preconditions: async () => ({ ok: false, missing: [{ key: "aviso_privacidad", label: "Aviso" }] }) } },
      { input: m, over: { secrets: { ...SECRETS, key: null } } },
    ];
    for (const c of cases) {
      const { d, stored, audits } = deps(c.over);
      const r = await registerCsd(d, c.input);
      expect(r.ok).toBe(false);
      expect(stored).toEqual([]);
      const out = JSON.stringify({ audits, r, logs });
      expect(findPlain(out, [...needles(c.input), ...needles(m), "contrasena-equivocada-B5"])).toEqual([]);
    }
  });
});

describe("B5 · respaldos y exportaciones del repo", () => {
  const SENSIBLES = /certif|csd|fiel|ciec|secret|salt|token/i;
  it("backup-data no incluye tablas de certificados, contraseñas ni la sal (lista cerrada)", () => {
    // La lista vive en handler.ts desde la corrección de backup-data (PR propio); antes, en index.ts.
    const handler = resolve(process.cwd(), "supabase/functions/backup-data/handler.ts");
    const src = readFileSync(existsSync(handler) ? handler : resolve(process.cwd(), "supabase/functions/backup-data/index.ts"), "utf8");
    const list = /const TABLES_TO_BACKUP = \[([\s\S]*?)\];/.exec(src);
    expect(list).not.toBeNull();
    const tables = [...list![1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
    expect(tables.length).toBeGreaterThan(10);
    for (const t of ["client_sat_certificates", "portal_csd_secrets", "portal_csd_registry", "moffin_client_fiel", "portal_pseudonym_salt", "moffin_client_sat_ciec"]) {
      expect(tables).not.toContain(t);
    }
    // Antes de la corrección de backup-data llevaba microsoft_tokens; después, ninguna.
    expect(tables.filter((t) => SENSIBLES.test(t)).filter((t) => t !== "microsoft_tokens")).toEqual([]);
    // Es una lista cerrada: no hay «todas las tablas» ni select de esquemas.
    expect(src).not.toMatch(/information_schema|pg_tables|pg_dump/);
  });
  it("nadie en el navegador ni en herramientas de exportación lee columnas cifradas del CSD", () => {
    const hits = execSync(
      "grep -rlE \"cert_ciphertext|key_ciphertext|password_ciphertext\" src supabase/functions tools --include=*.ts --include=*.tsx --include=*.mjs --include=*.js || true",
      { cwd: process.cwd(), encoding: "utf8" },
    ).split("\n").filter((f) => f && !f.startsWith("src/test/") && f !== "src/integrations/supabase/types.ts").sort();
    // Solo escriben/leen cifrado: la Edge de certificados, Moffin (e.firma), portal-api (guarda) y la rotación.
    expect(hits).toEqual([
      "supabase/functions/client-sat-certificates/index.ts",
      "supabase/functions/moffin-fiel/index.ts",
      "supabase/functions/moffin-query/index.ts",
      "supabase/functions/portal-api/index.ts",
      "tools/portal/rotate-csd-secrets.mjs",
    ]);
    expect(hits.some((f) => f.startsWith("src/"))).toBe(false);
  });
});
