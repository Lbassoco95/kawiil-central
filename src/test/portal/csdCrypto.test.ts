/** C5: la rotación usa exactamente el mismo cifrado que la Edge (moffinFielCrypto). */
import { describe, it, expect } from "vitest";
import { encryptFielSecret, decryptFielSecret } from "../../../supabase/functions/_shared/moffinFielCrypto.ts";
// @ts-expect-error módulo .mjs sin tipos
import { encrypt, decrypt, reencrypt } from "../../../tools/portal/csdCrypto.mjs";

const A = "a".repeat(40), B = "b".repeat(40);
describe("cifrado del CSD para rotación", () => {
  it("interopera con la Edge en ambos sentidos", async () => {
    expect(await decrypt(await encryptFielSecret("material-sintetico", A), A)).toBe("material-sintetico");
    expect(await decryptFielSecret(await encrypt("material-sintetico", A), A)).toBe("material-sintetico");
  });
  it("re-cifra con el secreto nuevo y el viejo deja de abrir", async () => {
    const rotated = await reencrypt(await encryptFielSecret("llave-sintetica", A), A, B);
    expect(await decryptFielSecret(rotated, B)).toBe("llave-sintetica");
    await expect(decrypt(rotated, A)).rejects.toBeTruthy();
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
describe("C5: ninguna función existente descifra filas csd_sello", () => {
  it("quien descifra con MOFFIN_FIEL_SECRET solo lee la vista de e.firma (cert_type = 'fiel')", () => {
    const root = resolve(process.cwd(), "supabase/functions");
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(n)) files.push(p);
    });
    walk(root);
    const decrypters = files.filter((f) => !f.includes("/_shared/") && !/\/portal-/.test(f) && /decryptFielSecret\(/.test(readFileSync(f, "utf8")));
    expect(decrypters.length).toBeGreaterThan(0);
    for (const f of decrypters) expect(readFileSync(f, "utf8"), f).not.toMatch(/from\(["']client_sat_certificates["']\)/);
    const view = readFileSync(resolve(process.cwd(), "supabase/migrations/20260505120000_client_sat_certificates.sql"), "utf8");
    expect(view).toMatch(/CREATE OR REPLACE VIEW public\.moffin_client_fiel[\s\S]*?WHERE cert_type = 'fiel'/);
  });
});
